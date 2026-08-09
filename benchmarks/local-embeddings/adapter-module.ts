import { createHash, type Hash } from "node:crypto";
import * as vm from "node:vm";

import ts from "typescript";

import { isSupportedAdapterNodeBuiltin } from "./adapter-contract.ts";
import type {
  AdapterBundleContract,
  AdapterCreateOptions,
  EmbeddingAdapter,
  EmbeddingAdapterFactory,
  EmbeddingCandidate,
  EmbeddingRole,
} from "./types.ts";

type AdapterModuleNamespace = {
  createEmbeddingAdapterFactory?: unknown;
};
type SandboxFactory = {
  create?: unknown;
};
type SandboxAdapterHandle = {
  adapter: unknown;
  identityJson: unknown;
  hasClose: unknown;
};
type SandboxInvokers = {
  createFactory(factoryCreator: unknown): Promise<SandboxFactory>;
  createAdapter(
    factory: SandboxFactory,
    payloadJson: string
  ): Promise<SandboxAdapterHandle>;
  load(adapter: unknown): Promise<void>;
  embed(adapter: unknown, payloadJson: string): Promise<unknown>;
  close(adapter: unknown): Promise<void>;
};

const MAX_ACTIVE_HASHES = 32;
const MAX_HASH_INPUT_BYTES = 4 * 1024 * 1024;
const SUPPORTED_BUNDLE_FORMAT = "self-contained-esm-bundle/v1";
const SUPPORTED_EXECUTION_BOUNDARY = "node-vm-source-text-module/v1";

/** Rejects dependency-loading syntax before any verified bundle code executes. */
function validateSelfContainedAdapterBundle(
  moduleBytes: Uint8Array,
  bundle: AdapterBundleContract
): void {
  if (bundle.format !== SUPPORTED_BUNDLE_FORMAT)
    throw new Error(`Unsupported adapter bundle contract: ${bundle.format}`);
  if (bundle.executionBoundary !== SUPPORTED_EXECUTION_BOUNDARY)
    throw new Error(
      `Unsupported adapter execution boundary: ${bundle.executionBoundary}`
    );
  for (const specifier of bundle.allowedNodeBuiltins)
    if (!isSupportedAdapterNodeBuiltin(specifier))
      throw new Error(`Adapter bundle builtin "${specifier}" is unsupported`);

  const sourceFile = ts.createSourceFile(
    "adapter-bundle.mjs",
    Buffer.from(moduleBytes).toString("utf8"),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics.length > 0)
    throw new Error("Adapter bundle is not valid JavaScript");

  const staticSpecifiers: string[] = [];
  let dynamicImportFound = false;
  let requireCallFound = false;
  /** Traverses parsed syntax so comments and strings cannot spoof validation. */
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      staticSpecifiers.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
        dynamicImportFound = true;
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      )
        requireCallFound = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (dynamicImportFound)
    throw new Error("Adapter bundle dynamic import() is forbidden");
  if (requireCallFound)
    throw new Error("Adapter bundle require() is forbidden");

  const allowedBuiltins = new Set(bundle.allowedNodeBuiltins);
  for (const specifier of staticSpecifiers) {
    if (!specifier.startsWith("node:"))
      throw new Error(
        `Adapter bundle import "${specifier}" is forbidden; bundle dependencies into the verified single file`
      );
    if (!isSupportedAdapterNodeBuiltin(specifier))
      throw new Error(`Adapter bundle builtin "${specifier}" is unsupported`);
    if (!allowedBuiltins.has(specifier))
      throw new Error(
        `Adapter bundle import "${specifier}" is not declared in its manifest`
      );
  }
}

/** Builds a context-native SHA-256 facade without exposing host functions. */
function createCryptoCapability(context: vm.Context): vm.SyntheticModule {
  const hashes = new Map<number, { hash: Hash; inputBytes: number }>();
  let nextToken = 1;
  const bridge = Object.freeze({
    create(algorithm: string): number {
      if (algorithm !== "sha256") throw new Error("unsupported algorithm");
      if (hashes.size >= MAX_ACTIVE_HASHES)
        throw new Error("hash limit exceeded");
      const token = nextToken++;
      hashes.set(token, { hash: createHash("sha256"), inputBytes: 0 });
      return token;
    },
    update(token: number, value: string): void {
      const state = hashes.get(token);
      if (!state) throw new Error("invalid hash state");
      const inputBytes = Buffer.byteLength(value, "utf8");
      if (state.inputBytes + inputBytes > MAX_HASH_INPUT_BYTES)
        throw new Error("hash byte limit exceeded");
      state.inputBytes += inputBytes;
      state.hash.update(value, "utf8");
    },
    digest(token: number): string {
      const state = hashes.get(token);
      if (!state) throw new Error("invalid hash state");
      hashes.delete(token);
      return state.hash.digest("hex");
    },
  });
  // The returned functions are created inside the restricted context. Host
  // bridge state remains lexical and only primitive values cross the boundary.
  const createFacade = vm.runInContext(
    `((bridge) => Object.freeze({
      createHash: Object.freeze(function createHash(algorithm) {
        if (typeof algorithm !== "string") throw new TypeError("Hash algorithm must be a string");
        let token;
        try { token = bridge.create(algorithm); }
        catch { throw new Error("Hash capability rejected create"); }
        let finished = false;
        const facade = {
          update(value, encoding) {
            if (finished) throw new Error("Hash is already finalized");
            if (typeof value !== "string" || (encoding !== undefined && encoding !== "utf8"))
              throw new TypeError("Hash capability accepts UTF-8 strings only");
            try { bridge.update(token, value); }
            catch { throw new Error("Hash capability rejected update"); }
            return facade;
          },
          digest(encoding) {
            if (finished) throw new Error("Hash is already finalized");
            if (encoding !== undefined && encoding !== "hex")
              throw new TypeError("Hash capability returns hexadecimal strings only");
            finished = true;
            try { return bridge.digest(token); }
            catch { throw new Error("Hash capability rejected digest"); }
          }
        };
        return Object.freeze(facade);
      })
    }))`,
    context
  ) as (bridgeValue: typeof bridge) => { createHash: unknown };
  const facade = createFacade(bridge);
  return new vm.SyntheticModule(
    ["createHash"],
    function initializeCryptoCapability() {
      this.setExport("createHash", facade.createHash);
    },
    { context, identifier: "capability:node:crypto" }
  );
}

/** Creates only the explicitly declared, audited module capability. */
function createCapabilityModule(
  specifier: string,
  bundle: AdapterBundleContract,
  context: vm.Context
): vm.Module {
  if (!bundle.allowedNodeBuiltins.includes(specifier))
    throw new Error(
      `Adapter sandbox denied undeclared module capability: ${specifier}`
    );
  if (specifier === "node:crypto") return createCryptoCapability(context);
  throw new Error(
    `Adapter sandbox denied unsupported capability: ${specifier}`
  );
}

/** Freezes ambient intrinsics before untrusted bundle initialization. */
function lockDownSandboxIntrinsics(context: vm.Context): void {
  vm.runInContext(
    `(() => {
      const constructors = [
        Object, Function, Array, Number, String, Boolean, BigInt, Symbol,
        Date, RegExp, Map, Set, WeakMap, WeakSet, Promise, Error, TypeError,
        RangeError, ReferenceError, SyntaxError, URIError, EvalError,
        ArrayBuffer, DataView, Uint8Array, Int8Array, Uint16Array, Int16Array,
        Uint32Array, Int32Array, Float32Array, Float64Array
      ];
      for (const constructor of constructors) {
        if (constructor.prototype) Object.freeze(constructor.prototype);
        Object.freeze(constructor);
      }
      for (const intrinsic of [JSON, Math, Reflect, Atomics]) Object.freeze(intrinsic);
      Object.freeze(globalThis);
    })()`,
    context
  );
}

/** Creates context-native invokers that exchange host data only as JSON text. */
function createSandboxInvokers(context: vm.Context): SandboxInvokers {
  return vm.runInContext(
    `(() => {
      const parse = JSON.parse.bind(JSON);
      const stringify = JSON.stringify.bind(JSON);
      return Object.freeze({
      async createFactory(factoryCreator) {
        if (typeof factoryCreator !== "function")
          throw new TypeError("Adapter module must export a factory function");
        const factory = await factoryCreator();
        if (!factory || typeof factory.create !== "function")
          throw new TypeError("Adapter factory must implement create");
        return factory;
      },
      async createAdapter(factory, payloadJson) {
        if (!factory || typeof factory.create !== "function")
          throw new TypeError("Adapter factory must implement create");
        const payload = parse(payloadJson);
        const adapter = await factory.create(payload.candidate, payload.options);
        if (!adapter || typeof adapter.load !== "function" || typeof adapter.embed !== "function")
          throw new TypeError("Adapter must implement load and embed");
        return Object.freeze({
          adapter,
          identityJson: stringify(adapter.identity),
          hasClose: typeof adapter.close === "function"
        });
      },
      async load(adapter) { await adapter.load(); },
      async embed(adapter, payloadJson) {
        const payload = parse(payloadJson);
        return stringify(await adapter.embed(payload.texts, payload.role));
      },
      async close(adapter) {
        if (typeof adapter.close === "function") await adapter.close();
      }
    });
    })()`,
    context
  ) as SandboxInvokers;
}

/** Converts a sandbox failure into a host-owned error without inspecting it. */
function sandboxFailure(operation: string): Error {
  return new Error(`Adapter sandbox ${operation} failed`);
}

/** Wraps a context-owned adapter so no host object crosses into bundle code. */
function createAdapterProxy(
  invokers: SandboxInvokers,
  handle: SandboxAdapterHandle
): EmbeddingAdapter {
  if (typeof handle.identityJson !== "string")
    throw new Error("Adapter sandbox returned an invalid identity");
  const identity = JSON.parse(
    handle.identityJson
  ) as EmbeddingAdapter["identity"];
  return {
    identity,
    async load() {
      try {
        await invokers.load(handle.adapter);
      } catch {
        throw sandboxFailure("load");
      }
    },
    async embed(texts: string[], role: EmbeddingRole) {
      try {
        const result = await invokers.embed(
          handle.adapter,
          JSON.stringify({ texts, role })
        );
        if (typeof result !== "string")
          throw new Error("invalid serialized embedding result");
        return JSON.parse(result) as number[][];
      } catch {
        throw sandboxFailure("embed");
      }
    },
    ...(handle.hasClose === true
      ? {
          async close() {
            try {
              await invokers.close(handle.adapter);
            } catch {
              throw sandboxFailure("close");
            }
          },
        }
      : {}),
  };
}

/** Links, evaluates, and creates the bundle factory inside one locked VM. */
async function initializeVerifiedAdapterSandbox(
  moduleBytes: Uint8Array,
  moduleChecksum: string,
  bundle: AdapterBundleContract
): Promise<{
  invokers: SandboxInvokers;
  sandboxFactory: SandboxFactory;
}> {
  if (typeof vm.SourceTextModule !== "function")
    throw new Error("Adapter sandbox requires Node --experimental-vm-modules");
  const context = vm.createContext(vm.constants.DONT_CONTEXTIFY, {
    name: `verified-adapter-${moduleChecksum}`,
    codeGeneration: { strings: false, wasm: false },
  });
  const invokers = createSandboxInvokers(context);
  lockDownSandboxIntrinsics(context);
  const capabilityModules = new Map<string, vm.Module>();
  const sourceModule = new vm.SourceTextModule(
    Buffer.from(moduleBytes).toString("utf8"),
    {
      context,
      identifier: `verified-adapter:${moduleChecksum}`,
      initializeImportMeta(meta) {
        Object.defineProperty(meta, "url", {
          configurable: false,
          enumerable: true,
          value: `verified-adapter:${moduleChecksum}`,
          writable: false,
        });
        Object.freeze(meta);
      },
      importModuleDynamically() {
        throw new Error("Adapter sandbox denied dynamic import");
      },
    }
  );
  try {
    await sourceModule.link((specifier) => {
      const existing = capabilityModules.get(specifier);
      if (existing) return existing;
      const capability = createCapabilityModule(specifier, bundle, context);
      capabilityModules.set(specifier, capability);
      return capability;
    });
    await sourceModule.evaluate({ timeout: 1_000 });
  } catch {
    throw sandboxFailure("initialization");
  }
  const namespace = sourceModule.namespace as AdapterModuleNamespace;
  if (typeof namespace.createEmbeddingAdapterFactory !== "function")
    throw new Error(
      "Adapter module must export createEmbeddingAdapterFactory as a named function"
    );
  let sandboxFactory: SandboxFactory;
  try {
    sandboxFactory = await invokers.createFactory(
      namespace.createEmbeddingAdapterFactory
    );
  } catch {
    throw sandboxFailure("factory creation");
  }
  return { invokers, sandboxFactory };
}

/** Defers all verified VM initialization into the measured create boundary. */
async function loadVerifiedAdapterFactory(
  moduleBytes: Uint8Array,
  moduleChecksum: string,
  bundle: AdapterBundleContract
): Promise<EmbeddingAdapterFactory> {
  validateSelfContainedAdapterBundle(moduleBytes, bundle);
  return {
    async create(
      candidate: EmbeddingCandidate,
      options: AdapterCreateOptions
    ): Promise<EmbeddingAdapter> {
      const { invokers, sandboxFactory } =
        await initializeVerifiedAdapterSandbox(
          moduleBytes,
          moduleChecksum,
          bundle
        );
      try {
        const handle = await invokers.createAdapter(
          sandboxFactory,
          JSON.stringify({ candidate, options })
        );
        return createAdapterProxy(invokers, handle);
      } catch {
        throw sandboxFailure("adapter creation");
      }
    },
  };
}

export { loadVerifiedAdapterFactory, validateSelfContainedAdapterBundle };
