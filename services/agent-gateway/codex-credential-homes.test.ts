import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
} from "node:path";

import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import * as credentialHomeModule from "./codex-credential-homes.ts";
import {
  assertTrustedCodexRuntimeAuthority,
  CodexCredentialHomeManager,
  type CredentialHomeCapabilities,
  CredentialHomeError,
  type CredentialHomeHostCapability,
  type CredentialHomeIdentity,
  type CredentialHomeLifecycleLease,
  type CredentialHomeLifecycleState,
  type CredentialHomeTeardown,
  type DurableCredentialHomeCoordinator,
  type DurableRootIdentityPins,
  FILE_CREDENTIAL_STORE_FLAG,
  type HostDeleteHomeResult,
  type HostEnsureHomeResult,
  type HostRootIdentity,
  type HostRootResult,
  type RootPinResult,
  type TeardownOptions,
} from "./codex-credential-homes.ts";

const temporaryDirectories: string[] = [];
const LOCAL_HOME_NAMESPACE = "sprig/codex-credential-home/v1";
const LOCAL_ROOT_NAMESPACE = "sprig/codex-root-pin/v1";
const LOCAL_DOMAIN = "local-test-emulator-v1";
const PRIVATE_MODE = 0o700;
const NO_STATE_OVERRIDE = Symbol("no-test-state-override");
const PRODUCTION_SOURCE_EXTENSION = /\.(?:js|jsx|ts|tsx|cjs|cts|mjs|mts)$/i;

type TestOnlyRuntimeEnvironment = Readonly<{
  authority: "test-only";
  env: Readonly<{ CODEX_HOME: string }>;
  sessionFlags: readonly [typeof FILE_CREDENTIAL_STORE_FLAG];
}>;

type TestOnlyEnsureResult = Readonly<{
  homeId: string;
  state: "created" | "existing";
  runtime: TestOnlyRuntimeEnvironment;
}>;

type LocalTestHostHooks = Readonly<{
  beforeDelete?: (input: {
    rootPath: string;
    homePath: string;
  }) => void | Promise<void>;
}>;

type LocalTestCoordinatorControls = Readonly<{
  failNextMarkRevoked: () => void;
  setNextLeaseState: (state: unknown) => void;
}>;

type LocalCredentialHomeTestCapabilities = CredentialHomeCapabilities &
  Readonly<{ controls: LocalTestCoordinatorControls }>;

/** In-memory coordinator used only inside this compiled test module. */
class LocalTestCoordinator implements DurableCredentialHomeCoordinator {
  readonly isolationDomain = LOCAL_DOMAIN;
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly states = new Map<string, CredentialHomeLifecycleState>();
  private failMarkRevoked = false;
  private nextStateOverride: unknown | typeof NO_STATE_OVERRIDE =
    NO_STATE_OVERRIDE;

  /** Injects one final-tombstone failure while retaining revoking state. */
  failNextMarkRevoked(): void {
    this.failMarkRevoked = true;
  }

  /** Supplies one controlled or malformed state to the next lease. */
  setNextLeaseState(state: unknown): void {
    this.nextStateOverride = state;
  }

  /** Serializes one local home and applies terminal transition rules. */
  async runExclusive<T>(
    homeId: string,
    operation: (lease: CredentialHomeLifecycleLease) => Promise<T>
  ): Promise<T> {
    const previous = this.locks.get(homeId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        let state: unknown =
          this.nextStateOverride === NO_STATE_OVERRIDE
            ? (this.states.get(homeId) ?? "provisionable")
            : this.nextStateOverride;
        this.nextStateOverride = NO_STATE_OVERRIDE;
        const lease: CredentialHomeLifecycleLease = {
          state,
          markActive: () => {
            if (state !== "provisionable" && state !== "active") {
              throw new Error("test active transition rejected");
            }
            state = "active";
            this.states.set(homeId, "active");
          },
          markRevoking: () => {
            if (
              state !== "provisionable" &&
              state !== "active" &&
              state !== "revoking"
            ) {
              throw new Error("test revoking transition rejected");
            }
            state = "revoking";
            this.states.set(homeId, "revoking");
          },
          markRevoked: () => {
            if (this.failMarkRevoked) {
              this.failMarkRevoked = false;
              throw new Error("test final tombstone failure");
            }
            if (state !== "revoking" && state !== "revoked") {
              throw new Error("test revoked transition rejected");
            }
            state = "revoked";
            this.states.set(homeId, "revoked");
          },
        };
        return operation(lease);
      });
    this.locks.set(homeId, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(homeId) === current) {
        this.locks.delete(homeId);
      }
    }
  }
}

/** In-memory root pins shared only by local managers in one test. */
class LocalTestRootPins implements DurableRootIdentityPins {
  readonly isolationDomain = LOCAL_DOMAIN;
  private readonly pins = new Map<string, HostRootIdentity>();

  /** Pins the first identity and rejects a later replacement. */
  async pinOrVerify(
    rootKey: string,
    identity: HostRootIdentity
  ): Promise<RootPinResult> {
    const existing = this.pins.get(rootKey);
    if (!existing) {
      this.pins.set(rootKey, identity);
      return "pinned";
    }
    return localIdentityEquals(existing, identity) ? "verified" : "mismatch";
  }
}

/** Path-based host emulator scoped to this test module only. */
class LocalTestHost implements CredentialHomeHostCapability {
  readonly isolationDomain = LOCAL_DOMAIN;

  constructor(private readonly hooks: LocalTestHostHooks = {}) {}

  /** Validates an already-provisioned local root. */
  async ensureRoot(rootPath: string): Promise<HostRootResult> {
    await localAssertSafeAncestors(dirname(rootPath));
    return localInspectPrivateDirectory(rootPath);
  }

  /** Inspects the current local root identity. */
  async inspectRoot(rootPath: string): Promise<HostRootResult> {
    return localInspectPrivateDirectory(rootPath);
  }

  /** Creates one flat private local home for behavior tests. */
  async ensureHome(input: {
    rootPath: string;
    rootIdentity: HostRootIdentity;
    homeId: string;
  }): Promise<HostEnsureHomeResult> {
    if (!(await localRootMatches(input.rootPath, input.rootIdentity))) {
      return { status: "unsafe" };
    }
    const homePath = join(input.rootPath, input.homeId);
    let state: "created" | "existing" = "created";
    try {
      await mkdir(homePath, { mode: PRIVATE_MODE });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }
      state = "existing";
    }
    const inspected = await localInspectPrivateDirectory(homePath);
    if (
      inspected.status !== "ok" ||
      !(await localRootMatches(input.rootPath, input.rootIdentity))
    ) {
      return { status: "unsafe" };
    }
    return { status: "ok", state, homePath };
  }

  /** Emulates identity checks around local deletion for adversarial tests. */
  async deleteHome(input: {
    rootPath: string;
    rootIdentity: HostRootIdentity;
    homeId: string;
  }): Promise<HostDeleteHomeResult> {
    if (!(await localRootMatches(input.rootPath, input.rootIdentity))) {
      return { status: "unsafe" };
    }
    const homePath = join(input.rootPath, input.homeId);
    const before = await localInspectOptionalDirectory(homePath);
    if (before === "absent") {
      return { status: "absent" };
    }
    if (before.status !== "ok") {
      return { status: "unsafe" };
    }
    await this.hooks.beforeDelete?.({ rootPath: input.rootPath, homePath });
    const after = await localInspectOptionalDirectory(homePath);
    if (
      after === "absent" ||
      after.status !== "ok" ||
      !localIdentityEquals(before.identity, after.identity) ||
      !(await localRootMatches(input.rootPath, input.rootIdentity))
    ) {
      return { status: "unsafe" };
    }
    await rm(homePath, { recursive: true, force: false, maxRetries: 0 });
    return (await localRootMatches(input.rootPath, input.rootIdentity))
      ? { status: "removed" }
      : { status: "unsafe" };
  }
}

/** Test-local manager that never registers or returns production authority. */
class TestOnlyCodexCredentialHomeManager {
  private readonly rootKey: string;
  private rootIdentity: HostRootIdentity | undefined;

  constructor(
    private readonly rootPath: string,
    private readonly capabilities: CredentialHomeCapabilities
  ) {
    if (
      !isAbsolute(rootPath) ||
      normalize(rootPath) !== rootPath ||
      rootPath === parse(rootPath).root
    ) {
      throw localConfigurationError();
    }
    localRequireMatchingDomain(capabilities);
    this.rootKey = localHash(LOCAL_ROOT_NAMESPACE, rootPath);
  }

  /** Pins one pre-provisioned local root. */
  async initialize(): Promise<void> {
    const root = await localCall(() =>
      this.capabilities.host.ensureRoot(this.rootPath)
    );
    const identity = localRequireSafeRoot(root);
    const pin = await localCall(() =>
      this.capabilities.rootPins.pinOrVerify(this.rootKey, identity)
    );
    if (pin === "mismatch") {
      throw localUnsafeError();
    }
    if (pin !== "pinned" && pin !== "verified") {
      throw localCapabilityError();
    }
    this.rootIdentity = identity;
  }

  /** Ensures only provisionable or active test-local homes. */
  async ensure(
    identity: CredentialHomeIdentity
  ): Promise<TestOnlyEnsureResult> {
    const homeId = localDeriveHomeId(identity);
    return this.coordinate(homeId, async (lease) => {
      const state = localRequireState(lease.state);
      if (state !== "provisionable" && state !== "active") {
        throw new CredentialHomeError(
          "credential_home_revoked",
          "Credential home is not executable"
        );
      }
      const rootIdentity = await this.verifyRoot();
      const result = await localCall(() =>
        this.capabilities.host.ensureHome({
          rootPath: this.rootPath,
          rootIdentity,
          homeId,
        })
      );
      if (
        !result ||
        result.status !== "ok" ||
        result.homePath !== join(this.rootPath, homeId) ||
        (result.state !== "created" && result.state !== "existing")
      ) {
        throw localUnsafeError();
      }
      await localPersist(() => lease.markActive());
      return {
        homeId,
        state: result.state,
        runtime: Object.freeze({
          authority: "test-only" as const,
          env: Object.freeze({ CODEX_HOME: result.homePath }),
          sessionFlags: Object.freeze([FILE_CREDENTIAL_STORE_FLAG] as const),
        }),
      };
    });
  }

  /** Commits revoking before callback/delete and advances only to revoked. */
  async teardown(
    identity: CredentialHomeIdentity,
    options: TeardownOptions
  ): Promise<CredentialHomeTeardown> {
    const homeId = localDeriveHomeId(identity);
    return this.coordinate(homeId, async (lease) => {
      const state = localRequireState(lease.state);
      if (state !== "revoked") {
        if (state !== "revoking") {
          await localPersist(() => lease.markRevoking());
        }
        try {
          await options.revoke();
        } catch {
          throw new CredentialHomeError(
            "credential_revocation_failed",
            "Credential revocation did not complete"
          );
        }
      }
      const rootIdentity = await this.verifyRoot();
      const deletion = await localCall(() =>
        this.capabilities.host.deleteHome({
          rootPath: this.rootPath,
          rootIdentity,
          homeId,
        })
      );
      if (!deletion || deletion.status === "unsafe") {
        throw localUnsafeError();
      }
      if (deletion.status !== "absent" && deletion.status !== "removed") {
        throw localCapabilityError();
      }
      if (state !== "revoked") {
        await localPersist(() => lease.markRevoked());
      }
      return { homeId, state: deletion.status };
    });
  }

  /** Verifies the local external pin before each host operation. */
  private async verifyRoot(): Promise<HostRootIdentity> {
    if (!this.rootIdentity) {
      throw localConfigurationError();
    }
    const inspected = localRequireSafeRoot(
      await localCall(() => this.capabilities.host.inspectRoot(this.rootPath))
    );
    if (!localIdentityEquals(inspected, this.rootIdentity)) {
      throw localUnsafeError();
    }
    const pin = await localCall(() =>
      this.capabilities.rootPins.pinOrVerify(this.rootKey, inspected)
    );
    if (pin !== "verified") {
      throw pin === "mismatch" ? localUnsafeError() : localCapabilityError();
    }
    return inspected;
  }

  /** Preserves only exact local callback errors across coordinator failures. */
  private async coordinate<T>(
    homeId: string,
    operation: (lease: CredentialHomeLifecycleLease) => Promise<T>
  ): Promise<T> {
    let callbackError: unknown;
    try {
      return await this.capabilities.coordinator.runExclusive(
        homeId,
        async (lease) => {
          try {
            return await operation(lease);
          } catch (error) {
            callbackError = error;
            throw error;
          }
        }
      );
    } catch (error) {
      if (error === callbackError && error instanceof CredentialHomeError) {
        throw error;
      }
      throw localCapabilityError();
    }
  }
}

/** Creates one test-local capability set; this function is not importable. */
function createLocalCredentialHomeTestCapabilities(
  hooks: LocalTestHostHooks = {}
): LocalCredentialHomeTestCapabilities {
  const coordinator = new LocalTestCoordinator();
  return {
    host: new LocalTestHost(hooks),
    rootPins: new LocalTestRootPins(),
    coordinator,
    controls: {
      failNextMarkRevoked: () => coordinator.failNextMarkRevoked(),
      setNextLeaseState: (state) => coordinator.setNextLeaseState(state),
    },
  };
}

/** Builds a stable tuple hash for test-local root and home identifiers. */
function localHash(namespace: string, value: string): string {
  return createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(value)
    .digest("hex");
}

/** Derives the same length-prefixed non-secret home ID used by production. */
function localDeriveHomeId(identity: CredentialHomeIdentity): string {
  for (const value of [identity.ownerId, identity.connectionId]) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 512 ||
      !/^[A-Za-z0-9_-]+$/.test(value) ||
      value === "." ||
      value === ".." ||
      isAbsolute(value)
    ) {
      throw new CredentialHomeError(
        "credential_home_identifier_invalid",
        "Credential home identity is invalid"
      );
    }
  }
  const digest = createHash("sha256")
    .update(LOCAL_HOME_NAMESPACE)
    .update("\0")
    .update(String(Buffer.byteLength(identity.ownerId)))
    .update(":")
    .update(identity.ownerId)
    .update("\0")
    .update(String(Buffer.byteLength(identity.connectionId)))
    .update(":")
    .update(identity.connectionId)
    .digest("hex");
  return `codex-${digest}`;
}

/** Validates explicit lifecycle states in the test-local manager. */
function localRequireState(value: unknown): CredentialHomeLifecycleState {
  if (
    value !== "active" &&
    value !== "provisionable" &&
    value !== "revoked" &&
    value !== "revoking"
  ) {
    throw localCapabilityError();
  }
  return value;
}

/** Validates one local root result without reflecting host errors. */
function localRequireSafeRoot(result: HostRootResult): HostRootIdentity {
  if (!result || result.status !== "ok") {
    throw localUnsafeError();
  }
  return result.identity;
}

/** Requires every local capability to share the test isolation domain. */
function localRequireMatchingDomain(
  capabilities: CredentialHomeCapabilities
): void {
  if (
    capabilities.host.isolationDomain !== LOCAL_DOMAIN ||
    capabilities.rootPins.isolationDomain !== LOCAL_DOMAIN ||
    capabilities.coordinator.isolationDomain !== LOCAL_DOMAIN
  ) {
    throw localConfigurationError();
  }
}

/** Rejects symlinks or non-directories in local root ancestors. */
async function localAssertSafeAncestors(path: string): Promise<void> {
  const filesystemRoot = parse(path).root;
  const components = relative(filesystemRoot, path)
    .split(/[/\\]/)
    .filter(Boolean);
  let current = filesystemRoot;
  for (const component of components) {
    current = join(current, component);
    const metadata = await lstat(current, { bigint: true });
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("local ancestor unsafe");
    }
  }
}

/** Inspects an exact private local directory. */
async function localInspectPrivateDirectory(
  path: string
): Promise<HostRootResult> {
  let metadata;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch {
    return { status: "unsafe" };
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    Number(metadata.mode & BigInt(0o777)) !== PRIVATE_MODE ||
    process.getuid === undefined ||
    metadata.uid !== BigInt(process.getuid())
  ) {
    return { status: "unsafe" };
  }
  const resolved = await realpath(path);
  const followed = await stat(resolved, { bigint: true });
  if (
    resolved !== path ||
    followed.dev !== metadata.dev ||
    followed.ino !== metadata.ino
  ) {
    return { status: "unsafe" };
  }
  return {
    status: "ok",
    identity: {
      device: `dev:${metadata.dev.toString(10)}`,
      inode: `ino:${metadata.ino.toString(10)}`,
      generation: `birth:${metadata.birthtimeNs.toString(10)}`,
    },
  };
}

/** Distinguishes a missing local leaf from unsafe existing state. */
async function localInspectOptionalDirectory(
  path: string
): Promise<HostRootResult | "absent"> {
  try {
    await lstat(path);
  } catch (error) {
    return isNodeError(error) && error.code === "ENOENT"
      ? "absent"
      : { status: "unsafe" };
  }
  return localInspectPrivateDirectory(path);
}

/** Checks the current local root against a pinned identity. */
async function localRootMatches(
  rootPath: string,
  expected: HostRootIdentity
): Promise<boolean> {
  const inspected = await localInspectPrivateDirectory(rootPath);
  return (
    inspected.status === "ok" &&
    localIdentityEquals(inspected.identity, expected)
  );
}

/** Compares every local root/home identity component. */
function localIdentityEquals(
  left: HostRootIdentity,
  right: HostRootIdentity
): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.generation === right.generation
  );
}

/** Maps local capability exceptions to one stable failure. */
async function localCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw localCapabilityError();
  }
}

/** Persists one local lifecycle transition without leaking backend errors. */
async function localPersist(
  operation: () => void | Promise<void>
): Promise<void> {
  try {
    await operation();
  } catch {
    throw localCapabilityError();
  }
}

/** Narrows local filesystem errors inside this test module. */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/** Creates the stable local capability failure. */
function localCapabilityError(): CredentialHomeError {
  return new CredentialHomeError(
    "credential_home_capability_unavailable",
    "Credential home isolation capability is unavailable"
  );
}

/** Creates the stable local configuration failure. */
function localConfigurationError(): CredentialHomeError {
  return new CredentialHomeError(
    "credential_home_configuration_invalid",
    "Credential home capabilities are invalid"
  );
}

/** Creates the stable local unsafe-state failure. */
function localUnsafeError(): CredentialHomeError {
  return new CredentialHomeError(
    "credential_home_unsafe",
    "Credential home isolation state is unsafe"
  );
}

type ManagerHarness = Readonly<{
  capabilities: LocalCredentialHomeTestCapabilities;
  manager: TestOnlyCodexCredentialHomeManager;
  parent: string;
  root: string;
}>;

/** Creates one real-path temporary parent so lexical symlinks stay observable. */
async function createTemporaryParent(): Promise<string> {
  const temporaryRoot = await realpath(tmpdir());
  const parent = await mkdtemp(join(temporaryRoot, "sprig-codex-homes-test-"));
  temporaryDirectories.push(parent);
  return parent;
}

/** Builds an explicitly non-production manager from shared local capabilities. */
function buildTestManager(
  root: string,
  capabilities: LocalCredentialHomeTestCapabilities
): TestOnlyCodexCredentialHomeManager {
  return new TestOnlyCodexCredentialHomeManager(root, capabilities);
}

/** Creates a pre-provisioned root and initializes one test-only manager. */
async function createManager(
  hooks: LocalTestHostHooks = {}
): Promise<ManagerHarness> {
  const parent = await createTemporaryParent();
  const root = join(parent, "durable-codex-homes");
  await mkdir(root, { mode: 0o700 });
  const capabilities = createLocalCredentialHomeTestCapabilities(hooks);
  const manager = buildTestManager(root, capabilities);
  await manager.initialize();
  return { capabilities, manager, parent, root };
}

/** Captures only the manager's stable public error type and code. */
async function captureCredentialHomeError(
  action: () => unknown | Promise<unknown>
): Promise<CredentialHomeError> {
  try {
    await action();
    throw new Error("Expected a CredentialHomeError");
  } catch (error) {
    expect(error).toBeInstanceOf(CredentialHomeError);
    return error as CredentialHomeError;
  }
}

/** Restores one ambient environment key after credential-canary tests. */
function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/** Parses source and returns literal module loads that target test-only paths. */
function findForbiddenTestModuleLoads(
  sourceText: string,
  fileName: string
): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    scriptKindForFile(fileName)
  );
  const forbidden: string[] = [];

  /** Records one static literal when it resolves to a test-only path. */
  const recordLiteral = (node: ts.Node | undefined): void => {
    if (
      node &&
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      isTestModuleSpecifier(node.text)
    ) {
      forbidden.push(node.text);
    }
  };

  /** Records loader calls and fails closed when their target is nonliteral. */
  const recordLoaderArgument = (node: ts.Node | undefined): void => {
    if (
      node &&
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ) {
      if (isTestModuleSpecifier(node.text)) {
        forbidden.push(node.text);
      }
      return;
    }
    forbidden.push("<nonliteral-module-load>");
  };

  /** Visits only syntax nodes that can load or re-export a module. */
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      recordLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      recordLiteral(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const isDynamicImport = expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(expression) && expression.text === "require";
      const isRequireResolve =
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === "require" &&
        expression.name.text === "resolve";
      const isModuleRequire =
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === "module" &&
        expression.name.text === "require";
      const isComputedRequireResolve =
        ts.isElementAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === "require" &&
        isLiteralProperty(expression.argumentExpression, "resolve");
      const isComputedModuleRequire =
        ts.isElementAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === "module" &&
        isLiteralProperty(expression.argumentExpression, "require");
      if (
        isDynamicImport ||
        isRequire ||
        isRequireResolve ||
        isModuleRequire ||
        isComputedRequireResolve ||
        isComputedModuleRequire
      ) {
        recordLoaderArgument(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return forbidden;
}

/** Matches one computed CommonJS loader property without evaluating code. */
function isLiteralProperty(
  node: ts.Expression | undefined,
  expected: string
): boolean {
  return (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    node.text === expected
  );
}

/** Maps every truthfully scanned JS/TS extension to its TypeScript parser mode. */
function scriptKindForFile(fileName: string): ts.ScriptKind {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (normalized.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (
    normalized.endsWith(".js") ||
    normalized.endsWith(".cjs") ||
    normalized.endsWith(".mjs")
  ) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Normalizes separators/case and recognizes test files or directories. */
function isTestModuleSpecifier(specifier: string): boolean {
  const normalized = specifier.replace(/\\/g, "/").toLowerCase();
  return normalized
    .split("/")
    .some(
      (segment) =>
        segment === "__tests__" || /\.(?:test|spec)(?:[._-]|$)/.test(segment)
    );
}

/** Distinguishes production source entries from test files/directories. */
function isProductionSourceEntry(entry: string): boolean {
  return (
    PRODUCTION_SOURCE_EXTENSION.test(entry) && !isTestModuleSpecifier(entry)
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("production Codex credential-home authority", () => {
  it("exports only production-safe runtime names", () => {
    expect(Object.keys(credentialHomeModule).sort()).toEqual([
      "CodexCredentialHomeManager",
      "CredentialHomeError",
      "FILE_CREDENTIAL_STORE_FLAG",
      "assertTrustedCodexRuntimeAuthority",
    ]);
  });

  it("forbids AST module loads of test paths from production source", async () => {
    const productionRoots = ["services", "app", "lib"];
    const violations: Array<{ file: string; specifier: string }> = [];
    for (const root of productionRoots) {
      const entries = await readdir(join(process.cwd(), root), {
        recursive: true,
      });
      for (const entry of entries) {
        if (!isProductionSourceEntry(entry)) {
          continue;
        }
        const file = join(root, entry);
        const content = await readFile(join(process.cwd(), file), "utf8");
        for (const specifier of findForbiddenTestModuleLoads(content, file)) {
          violations.push({ file, specifier });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it.each([
    ["ESM import", 'import value from "./feature.test.ts";', "fixture.ts"],
    ["ESM export", 'export * from "./feature.SPEC.mts";', "fixture.mts"],
    [
      "dynamic import",
      'const value = import("./Feature.TEST/entry.mjs");',
      "fixture.mjs",
    ],
    ["CJS require", 'require("./nested/value.spec.cjs");', "fixture.cjs"],
    [
      "require.resolve",
      String.raw`require.resolve(".\\folder\\value.TEST.js");`,
      "fixture.js",
    ],
    [
      "import equals",
      'import value = require("./feature.test/entry.cts");',
      "fixture.cts",
    ],
    [
      "test directory",
      'import value from "./nested/__TeStS__/entry.tsx";',
      "fixture.tsx",
    ],
    [
      "spec directory",
      'export { value } from "./nested/feature.SpEc/entry.jsx";',
      "fixture.jsx",
    ],
  ])("detects %s test-module loads", (_label, source, fileName) => {
    expect(findForbiddenTestModuleLoads(source, fileName)).toHaveLength(1);
  });

  it.each([
    ["ordinary import", 'import value from "./feature.ts";', "fixture.ts"],
    [
      "comment text",
      '// require("./feature.test.ts")\nexport const value = 1;',
      "fixture.js",
    ],
    [
      "string data",
      "const value = 'import(\"./feature.spec.ts\")';",
      "fixture.ts",
    ],
    [
      "ordinary inert variable",
      'const moduleName = "./feature.test.ts";',
      "fixture.mts",
    ],
    [
      "other object resolve",
      'loader.resolve("./feature.test.ts");',
      "fixture.cjs",
    ],
  ])("allows %s without false positives", (_label, source, fileName) => {
    expect(findForbiddenTestModuleLoads(source, fileName)).toEqual([]);
  });

  it.each([
    [
      "former static test-support import",
      'import value from "./codex-credential-homes.test-support.ts";',
      "fixture.ts",
    ],
    [
      "dynamic spec-helper import",
      'const value = import("./feature.spec-helper.ts");',
      "fixture.mts",
    ],
    [
      "underscore require path",
      'require("./feature.test_helper.cjs");',
      "fixture.cjs",
    ],
    [
      "Windows directory require path",
      String.raw`require(".\\feature.SpEc-helper\\entry.js");`,
      "fixture.js",
    ],
  ])("rejects exact delimiter canary: %s", (_label, source, fileName) => {
    expect(findForbiddenTestModuleLoads(source, fileName)).toHaveLength(1);
  });

  it.each([
    ["nonliteral dynamic import", "import(moduleName);", "fixture.mts"],
    ["nonliteral require", "require(moduleName);", "fixture.cjs"],
    [
      "nonliteral require.resolve",
      "require.resolve(moduleName);",
      "fixture.js",
    ],
    ["nonliteral module.require", "module.require(moduleName);", "fixture.cjs"],
    [
      "computed require.resolve",
      'require["resolve"](moduleName);',
      "fixture.cts",
    ],
    [
      "computed module.require",
      'module["require"](moduleName);',
      "fixture.cjs",
    ],
    [
      "literal module.require test path",
      'module.require("./feature.test-helper.js");',
      "fixture.cjs",
    ],
    [
      "literal computed require.resolve test path",
      'require["resolve"]("./feature.spec_helper.ts");',
      "fixture.ts",
    ],
  ])("fails closed for loader canary: %s", (_label, source, fileName) => {
    expect(findForbiddenTestModuleLoads(source, fileName)).toHaveLength(1);
  });

  it.each([
    "codex-credential-homes.test-support.ts",
    "feature.spec-helper.ts",
    "feature.test_helper.cts",
    "nested/feature.spec/entry.tsx",
    String.raw`nested\feature.TEST-support\entry.mts`,
    "nested/__TeStS__/entry.jsx",
  ])("classifies test production-source candidate %s", (entry) => {
    expect(isProductionSourceEntry(entry)).toBe(false);
  });

  it.each([
    "contest-support.ts",
    "specialist.ts",
    "nested/contest-support/entry.ts",
    "feature.testing.ts",
    "feature.specialist.mjs",
  ])("keeps ordinary production-source candidate %s", (entry) => {
    expect(isProductionSourceEntry(entry)).toBe(true);
  });

  it("fails closed because no production provisioner exists", async () => {
    const parent = await createTemporaryParent();
    const manager = new CodexCredentialHomeManager({
      rootPath: join(parent, "nonexistent-root"),
    });

    const error = await captureCredentialHomeError(() => manager.initialize());
    expect(error.code).toBe("credential_home_capability_unavailable");
  });

  it.each(["cast", "wrapper", "proxy"] as const)(
    "rejects a structurally forged %s authority before root access",
    async (variant) => {
      const parent = await createTemporaryParent();
      const root = join(parent, "nonexistent-root");
      const capabilities = createLocalCredentialHomeTestCapabilities();
      const fakeAuthority = {
        capabilities,
        environment: "production",
        siblingHomesInaccessible: true,
        identityBoundDeletion: true,
        persistentRevokedTombstones: true,
      };
      const authority =
        variant === "proxy"
          ? new Proxy(fakeAuthority, {})
          : variant === "wrapper"
            ? { ...fakeAuthority }
            : (fakeAuthority as unknown);
      const manager = new CodexCredentialHomeManager({
        rootPath: root,
        authority,
      });

      const error = await captureCredentialHomeError(() =>
        manager.initialize()
      );
      expect(error.code).toBe("credential_home_capability_unavailable");
      await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
    }
  );

  it("rejects the exported test capability set as production authority", async () => {
    const parent = await createTemporaryParent();
    const root = join(parent, "nonexistent-root");
    const capabilities = createLocalCredentialHomeTestCapabilities();
    const manager = new CodexCredentialHomeManager({
      rootPath: root,
      authority: capabilities,
    });

    const error = await captureCredentialHomeError(() => manager.initialize());
    expect(error.code).toBe("credential_home_capability_unavailable");
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects nonexistent roots in the separate test-only API", async () => {
    const parent = await createTemporaryParent();
    const root = join(parent, "nonexistent-root");
    const manager = buildTestManager(
      root,
      createLocalCredentialHomeTestCapabilities()
    );

    const error = await captureCredentialHomeError(() => manager.initialize());
    expect(error.code).toBe("credential_home_unsafe");
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never upgrades test runtime values, casts, or proxies to production", async () => {
    const { manager } = await createManager();
    const runtime = (
      await manager.ensure({
        ownerId: "user_test_runtime",
        connectionId: "conn_test_runtime",
      })
    ).runtime;

    const productionLookingRuntime = {
      authority: "production",
      env: runtime.env,
      sessionFlags: runtime.sessionFlags,
    };
    for (const candidate of [
      runtime,
      { ...runtime },
      new Proxy(runtime, {}),
      productionLookingRuntime,
    ]) {
      const error = await captureCredentialHomeError(() =>
        assertTrustedCodexRuntimeAuthority(candidate)
      );
      expect(error.code).toBe("credential_home_capability_unavailable");
    }
    expect(runtime.authority).toBe("test-only");
  });

  it("rejects mismatched test capability domains", async () => {
    const parent = await createTemporaryParent();
    const root = join(parent, "homes");
    await mkdir(root, { mode: 0o700 });
    const capabilities = createLocalCredentialHomeTestCapabilities();
    const coordinator: DurableCredentialHomeCoordinator = {
      isolationDomain: "wrong-domain",
      runExclusive: (homeId, operation) =>
        capabilities.coordinator.runExclusive(homeId, operation),
    };

    const error = await captureCredentialHomeError(() =>
      buildTestManager(root, { ...capabilities, coordinator })
    );
    expect(error.code).toBe("credential_home_configuration_invalid");
  });
});

describe("test-only Codex credential-home lifecycle", () => {
  it("isolates owners and connections without exposing either identifier", async () => {
    const { manager } = await createManager();
    const first = await manager.ensure({
      ownerId: "user_owner_alpha",
      connectionId: "connection_shared",
    });
    const secondOwner = await manager.ensure({
      ownerId: "user_owner_beta",
      connectionId: "connection_shared",
    });
    const secondConnection = await manager.ensure({
      ownerId: "user_owner_alpha",
      connectionId: "connection_other",
    });

    expect(
      new Set([first.homeId, secondOwner.homeId, secondConnection.homeId])
    ).toHaveLength(3);
    for (const result of [first, secondOwner, secondConnection]) {
      expect(result.homeId).toMatch(/^codex-[a-f0-9]{64}$/);
      expect(result.homeId).not.toContain("owner");
      expect(result.homeId).not.toContain("connection");
      expect(result.runtime.authority).toBe("test-only");
    }
  });

  it("returns a minimal pinned environment with no ambient credentials", async () => {
    const canary = "ambient-provider-secret-canary-7b78a";
    const names = [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CODEX_HOME",
    ] as const;
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]])
    );
    for (const name of names) {
      process.env[name] = canary;
    }

    try {
      const { manager } = await createManager();
      const result = await manager.ensure({
        ownerId: "user_env",
        connectionId: "conn_env",
      });
      expect(Object.keys(result.runtime.env)).toEqual(["CODEX_HOME"]);
      expect(JSON.stringify(result.runtime)).not.toContain(canary);
      expect(result.runtime.sessionFlags).toEqual([FILE_CREDENTIAL_STORE_FLAG]);
    } finally {
      for (const name of names) {
        restoreEnvironment(name, previous[name]);
      }
    }
  });

  it("serializes concurrent ensure across manager instances", async () => {
    const { capabilities, manager, root } = await createManager();
    const secondManager = buildTestManager(root, capabilities);
    await secondManager.initialize();
    const identity = {
      ownerId: "user_cross_manager",
      connectionId: "conn_cross_manager",
    };
    const results = await Promise.all([
      manager.ensure(identity),
      secondManager.ensure(identity),
      manager.ensure(identity),
      secondManager.ensure(identity),
    ]);

    expect(new Set(results.map((result) => result.homeId))).toHaveLength(1);
    expect(results.filter((result) => result.state === "created")).toHaveLength(
      1
    );
    expect(
      results.filter((result) => result.state === "existing")
    ).toHaveLength(3);
  });

  it("uses one external root pin across manager restart", async () => {
    const { capabilities, manager, root } = await createManager();
    const identity = { ownerId: "user_restart", connectionId: "conn_restart" };
    const first = await manager.ensure(identity);
    await writeFile(
      join(first.runtime.env.CODEX_HOME, "state-sentinel"),
      "durable"
    );

    const restarted = buildTestManager(root, capabilities);
    await restarted.initialize();
    const second = await restarted.ensure(identity);
    expect(second).toMatchObject({ homeId: first.homeId, state: "existing" });
    expect(
      await readFile(
        join(second.runtime.env.CODEX_HOME, "state-sentinel"),
        "utf8"
      )
    ).toBe("durable");
  });

  it("rejects root substitution when a fresh manager verifies the pin", async () => {
    const { capabilities, root } = await createManager();
    const displacedRoot = `${root}-original`;
    await rename(root, displacedRoot);
    await mkdir(root, { mode: 0o700 });

    const restarted = buildTestManager(root, capabilities);
    const error = await captureCredentialHomeError(() =>
      restarted.initialize()
    );
    expect(error.code).toBe("credential_home_unsafe");
    expect((await lstat(displacedRoot)).isDirectory()).toBe(true);
  });

  it("persists revoking before callback and denies queued ensure", async () => {
    const { capabilities, manager, root } = await createManager();
    const secondManager = buildTestManager(root, capabilities);
    await secondManager.initialize();
    const identity = { ownerId: "user_race", connectionId: "conn_race" };
    await manager.ensure(identity);
    let releaseRevocation: (() => void) | undefined;
    let revocationStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      revocationStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });

    const teardown = manager.teardown(identity, {
      revoke: async () => {
        revocationStarted?.();
        await release;
      },
    });
    await started;
    const queuedEnsure = secondManager.ensure(identity);
    releaseRevocation?.();

    await expect(teardown).resolves.toMatchObject({ state: "removed" });
    expect((await captureCredentialHomeError(() => queuedEnsure)).code).toBe(
      "credential_home_revoked"
    );
  });

  it("keeps revoking terminal when provider callback fails and retries safely", async () => {
    const { capabilities, manager, root } = await createManager();
    const identity = {
      ownerId: "user_callback_failure",
      connectionId: "conn_callback_failure",
    };
    const ensured = await manager.ensure(identity);
    let callbackCount = 0;
    const firstError = await captureCredentialHomeError(() =>
      manager.teardown(identity, {
        revoke: () => {
          callbackCount += 1;
          throw new Error("provider-secret-canary");
        },
      })
    );
    expect(firstError.code).toBe("credential_revocation_failed");
    expect((await lstat(ensured.runtime.env.CODEX_HOME)).isDirectory()).toBe(
      true
    );

    const freshManager = buildTestManager(root, capabilities);
    await freshManager.initialize();
    expect(
      (await captureCredentialHomeError(() => freshManager.ensure(identity)))
        .code
    ).toBe("credential_home_revoked");

    const result = await freshManager.teardown(identity, {
      revoke: () => {
        callbackCount += 1;
      },
    });
    expect(result.state).toBe("removed");
    expect(callbackCount).toBe(2);
  });

  it("stays revoking when final tombstone persistence fails", async () => {
    const { capabilities, manager, root } = await createManager();
    const identity = {
      ownerId: "user_mark_failure",
      connectionId: "conn_mark_failure",
    };
    await manager.ensure(identity);
    capabilities.controls.failNextMarkRevoked();
    let callbackCount = 0;

    const error = await captureCredentialHomeError(() =>
      manager.teardown(identity, {
        revoke: () => {
          callbackCount += 1;
        },
      })
    );
    expect(error.code).toBe("credential_home_capability_unavailable");

    const freshManager = buildTestManager(root, capabilities);
    await freshManager.initialize();
    expect(
      (await captureCredentialHomeError(() => freshManager.ensure(identity)))
        .code
    ).toBe("credential_home_revoked");
    const retry = await freshManager.teardown(identity, {
      revoke: () => {
        callbackCount += 1;
      },
    });
    expect(retry.state).toBe("absent");
    expect(callbackCount).toBe(2);
  });

  it.each([undefined, null, "unknown", 0, {}, []])(
    "denies malformed lifecycle state %j",
    async (state) => {
      const { capabilities, manager } = await createManager();
      capabilities.controls.setNextLeaseState(state);
      const error = await captureCredentialHomeError(() =>
        manager.ensure({
          ownerId: "user_malformed_state",
          connectionId: "conn_malformed_state",
        })
      );
      expect(error.code).toBe("credential_home_capability_unavailable");
    }
  );

  it("fails closed when lifecycle coordination is unavailable", async () => {
    const parent = await createTemporaryParent();
    const root = join(parent, "homes");
    await mkdir(root, { mode: 0o700 });
    const capabilities = createLocalCredentialHomeTestCapabilities();
    const canary = "coordinator-secret-canary-319c";
    const coordinator: DurableCredentialHomeCoordinator = {
      isolationDomain: capabilities.coordinator.isolationDomain,
      runExclusive: async () => {
        throw new Error(canary);
      },
    };
    const manager = buildTestManager(root, {
      ...capabilities,
      coordinator,
    });
    await manager.initialize();

    const error = await captureCredentialHomeError(() =>
      manager.ensure({ ownerId: "user_safe", connectionId: "conn_safe" })
    );
    expect(error.code).toBe("credential_home_capability_unavailable");
    expect(error.message).not.toContain(canary);
  });

  it("keeps final teardown idempotent without invoking revoke again", async () => {
    const { manager } = await createManager();
    const identity = { ownerId: "user_absent", connectionId: "conn_absent" };
    let callbackCount = 0;
    const revoke = () => {
      callbackCount += 1;
    };
    const first = await manager.teardown(identity, { revoke });
    const second = await manager.teardown(identity, { revoke });
    expect(first).toEqual({ homeId: second.homeId, state: "absent" });
    expect(callbackCount).toBe(1);
  });

  it("removes nested state while preserving root and sibling homes", async () => {
    const { manager, root } = await createManager();
    const removedIdentity = {
      ownerId: "user_remove",
      connectionId: "conn_remove",
    };
    const keptIdentity = { ownerId: "user_keep", connectionId: "conn_keep" };
    const removed = await manager.ensure(removedIdentity);
    const kept = await manager.ensure(keptIdentity);
    await mkdir(join(removed.runtime.env.CODEX_HOME, "partial", "nested"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(join(root, "root-sentinel"), "keep-root");

    const result = await manager.teardown(removedIdentity, {
      revoke: () => undefined,
    });
    expect(result).toEqual({ homeId: removed.homeId, state: "removed" });
    await expect(lstat(removed.runtime.env.CODEX_HOME)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await lstat(kept.runtime.env.CODEX_HOME)).isDirectory()).toBe(true);
    expect(await readFile(join(root, "root-sentinel"), "utf8")).toBe(
      "keep-root"
    );
  });
});

describe("test-only adversarial host behavior", () => {
  it("fails identity-bound deletion when the home leaf is swapped", async () => {
    let displacedHome = "";
    const harness = await createManager({
      beforeDelete: async ({ homePath }) => {
        displacedHome = `${homePath}-original`;
        await rename(homePath, displacedHome);
        await mkdir(homePath, { mode: 0o700 });
      },
    });
    const identity = {
      ownerId: "user_leaf_swap",
      connectionId: "conn_leaf_swap",
    };
    await harness.manager.ensure(identity);

    const error = await captureCredentialHomeError(() =>
      harness.manager.teardown(identity, { revoke: () => undefined })
    );
    expect(error.code).toBe("credential_home_unsafe");
    expect((await lstat(displacedHome)).isDirectory()).toBe(true);
    expect(
      (await captureCredentialHomeError(() => harness.manager.ensure(identity)))
        .code
    ).toBe("credential_home_revoked");
  });

  it("fails deletion when the durable root is swapped during the host call", async () => {
    let displacedRoot = "";
    const harness = await createManager({
      beforeDelete: async ({ rootPath }) => {
        displacedRoot = `${rootPath}-original`;
        await rename(rootPath, displacedRoot);
        await mkdir(rootPath, { mode: 0o700 });
      },
    });
    const identity = {
      ownerId: "user_root_swap",
      connectionId: "conn_root_swap",
    };
    await harness.manager.ensure(identity);

    const error = await captureCredentialHomeError(() =>
      harness.manager.teardown(identity, { revoke: () => undefined })
    );
    expect(error.code).toBe("credential_home_unsafe");
    expect((await lstat(displacedRoot)).isDirectory()).toBe(true);
  });

  it("rejects symlink ancestors, roots, leaves, and permissive nodes", async () => {
    const parent = await createTemporaryParent();
    const target = join(parent, "target");
    const ancestor = join(parent, "ancestor");
    await mkdir(target, { mode: 0o700 });
    await symlink(target, ancestor);
    const ancestorManager = buildTestManager(
      join(ancestor, "homes"),
      createLocalCredentialHomeTestCapabilities()
    );
    expect(
      (await captureCredentialHomeError(() => ancestorManager.initialize()))
        .code
    ).toBe("credential_home_capability_unavailable");

    const rootLink = join(parent, "root-link");
    await symlink(target, rootLink);
    const linkedManager = buildTestManager(
      rootLink,
      createLocalCredentialHomeTestCapabilities()
    );
    expect(
      (await captureCredentialHomeError(() => linkedManager.initialize())).code
    ).toBe("credential_home_unsafe");

    const harness = await createManager();
    const leafIdentity = { ownerId: "user_leaf", connectionId: "conn_leaf" };
    const leaf = await harness.manager.ensure(leafIdentity);
    await rm(leaf.runtime.env.CODEX_HOME, { recursive: true });
    await symlink(target, leaf.runtime.env.CODEX_HOME);
    expect(
      (
        await captureCredentialHomeError(() =>
          harness.manager.ensure(leafIdentity)
        )
      ).code
    ).toBe("credential_home_unsafe");

    const modeIdentity = { ownerId: "user_mode", connectionId: "conn_mode" };
    const modeHome = await harness.manager.ensure(modeIdentity);
    await chmod(modeHome.runtime.env.CODEX_HOME, 0o755);
    expect(
      (
        await captureCredentialHomeError(() =>
          harness.manager.ensure(modeIdentity)
        )
      ).code
    ).toBe("credential_home_unsafe");
  });

  it.each([
    "",
    ".",
    "..",
    "../connection",
    "owner/connection",
    "owner\\connection",
    "/absolute",
    "nul\0byte",
    "space value",
    "x".repeat(513),
  ])("rejects hostile identity value %j without path use", async (value) => {
    const { manager } = await createManager();
    const error = await captureCredentialHomeError(() =>
      manager.ensure({ ownerId: value, connectionId: "conn_safe" })
    );
    expect(error.code).toBe("credential_home_identifier_invalid");
    if (value.length > 0) {
      expect(error.message).not.toContain(value);
    }
  });
});
