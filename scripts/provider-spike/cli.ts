import { pathToFileURL } from "node:url";

import {
  ClaudeCliValidationAdapter,
  runClaudeSetupTokenProbe,
  StdinTokenSource,
} from "./claude-setup-token.ts";
import {
  assertTemporaryCodexHome,
  runCodexDeviceCodeProbe,
  runCodexLogoutRestartProbe,
  StdioCodexProbeSessionFactory,
} from "./codex-app-server.ts";
import { sanitizeForOutput } from "./security.ts";

const HELP = `Sprig provider seam spike (dry-run by default)

Usage:
  pnpm provider:spike -- help
  pnpm provider:spike -- codex-device --codex-home <private-temp-dir> [--execute]
  pnpm provider:spike -- codex-logout-restart --codex-home <private-temp-dir> [--execute]
  pnpm provider:spike -- claude-token [--execute] < token-file

Safety:
  Without --execute no provider process starts and stdin is not read.
  Codex commands require an existing mode-0700 child of the OS temp directory.
  Claude tokens are accepted only from stdin and are never printed.
`;

type ProviderSpikeCommand =
  | "help"
  | "codex-device"
  | "codex-logout-restart"
  | "claude-token";

type CliOptions = {
  command: ProviderSpikeCommand;
  execute: boolean;
  codexHome?: string;
};

type CliDependencies = {
  codexFactory: StdioCodexProbeSessionFactory;
  claudeAdapter: ClaudeCliValidationAdapter;
  tokenSource: StdinTokenSource;
  write: (value: unknown) => void;
};

/** Parses the spike CLI while keeping every command dry-run by default. */
function parseCliOptions(argv: string[]): CliOptions {
  const args = argv[0] === "--" ? argv.slice(1) : argv;

  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    return { command: "help", execute: false };
  }

  const command = args[0];
  if (
    command !== "codex-device" &&
    command !== "codex-logout-restart" &&
    command !== "claude-token"
  ) {
    throw new Error(`Unknown provider spike command: ${command}`);
  }

  const options: CliOptions = { command, execute: false };
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--dry-run") {
      options.execute = false;
    } else if (argument === "--codex-home") {
      const codexHome = args[index + 1];
      if (!codexHome || codexHome.startsWith("--")) {
        throw new Error("--codex-home requires a directory path");
      }
      options.codexHome = codexHome;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (command === "claude-token" && options.codexHome !== undefined) {
    throw new Error("--codex-home is not valid for claude-token");
  }

  if (
    options.execute &&
    command !== "claude-token" &&
    options.codexHome === undefined
  ) {
    throw new Error("--codex-home is required with --execute");
  }

  return options;
}

/** Runs one explicitly gated probe or prints its non-mutating dry-run plan. */
async function main(
  argv = process.argv.slice(2),
  dependencies: CliDependencies = {
    codexFactory: new StdioCodexProbeSessionFactory(),
    claudeAdapter: new ClaudeCliValidationAdapter(),
    tokenSource: new StdinTokenSource(),
    write: writeJson,
  }
): Promise<void> {
  const options = parseCliOptions(argv);
  if (options.command === "help") {
    dependencies.write(HELP);
    return;
  }

  if (!options.execute) {
    dependencies.write({
      mode: "dry-run",
      command: options.command,
      providerProcessStarted: false,
      stdinRead: false,
      next: "Repeat with --execute after reviewing docs/PROVIDER_SPIKE.md",
    });
    return;
  }

  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);

  try {
    if (options.command === "claude-token") {
      const result = await runClaudeSetupTokenProbe({
        tokenSource: dependencies.tokenSource,
        adapter: dependencies.claudeAdapter,
        signal: controller.signal,
      });
      dependencies.write({ mode: "execute", command: options.command, result });
      return;
    }

    const codexHome = await assertTemporaryCodexHome(options.codexHome!);
    if (options.command === "codex-device") {
      const result = await runCodexDeviceCodeProbe({
        codexHome,
        factory: dependencies.codexFactory,
        signal: controller.signal,
        onCeremony: (ceremony) =>
          dependencies.write({ event: "device-code", ...ceremony }),
      });
      dependencies.write({ mode: "execute", command: options.command, result });
      return;
    }

    const result = await runCodexLogoutRestartProbe({
      codexHome,
      factory: dependencies.codexFactory,
      signal: controller.signal,
    });
    dependencies.write({ mode: "execute", command: options.command, result });
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

/** Emits bounded, recursively sanitized JSON for operator inspection. */
function writeJson(value: unknown): void {
  // eslint-disable-next-line no-console -- This file is an operator CLI.
  console.log(
    typeof value === "string"
      ? value
      : JSON.stringify(sanitizeForOutput(value), null, 2)
  );
}

const importMeta = import.meta as ImportMeta & { main?: boolean };
const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;
const isMainModule = importMeta.main ?? import.meta.url === invokedPath;

if (isMainModule) {
  void main().catch((error: unknown) => {
    // eslint-disable-next-line no-console -- CLI failures must reach operators.
    console.error(
      sanitizeForOutput(
        error instanceof Error ? error.message : "Provider spike failed"
      )
    );
    process.exitCode = 1;
  });
}

export {
  type CliDependencies,
  type CliOptions,
  HELP,
  main,
  parseCliOptions,
  type ProviderSpikeCommand,
  writeJson,
};
