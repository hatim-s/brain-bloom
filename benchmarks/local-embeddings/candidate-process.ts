import { type ChildProcess, fork, type ForkOptions } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type ProcessTreeTerminator,
  terminateProcessTree,
} from "../../scripts/provider-spike/process.ts";
import type {
  CandidateProcessExecutor,
  CandidateProcessRequest,
} from "./runner.ts";
import type { CandidateBenchmarkResult } from "./types.ts";

type ChildResponse =
  | { ok: true; result: CandidateBenchmarkResult }
  | { ok: false; error: string };
type ForkCandidate = (
  modulePath: string,
  args: string[],
  options: ForkOptions
) => ChildProcess;
type CandidateProcessDependencies = {
  forkCandidate?: ForkCandidate;
  terminateTree?: ProcessTreeTerminator;
};

const childPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "candidate-child.ts"
);

/** Narrows an IPC payload before it can settle the parent benchmark. */
function parseChildResponse(message: unknown): ChildResponse {
  if (!message || typeof message !== "object" || !("ok" in message))
    throw new Error("Candidate child returned an invalid response");
  const response = message as Record<string, unknown>;
  if (
    response.ok === true &&
    response.result &&
    typeof response.result === "object"
  )
    return { ok: true, result: response.result as CandidateBenchmarkResult };
  if (response.ok === false && typeof response.error === "string")
    return { ok: false, error: response.error };
  throw new Error("Candidate child returned an invalid response");
}

/** Executes one candidate with a finite deadline and idempotent tree cleanup. */
async function executeCandidateProcess(
  request: CandidateProcessRequest,
  dependencies: CandidateProcessDependencies = {}
): Promise<CandidateBenchmarkResult> {
  const timeoutMs = request.configuration.measurement.candidateTimeoutMs;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 3_600_000
  )
    throw new Error("Candidate timeout must be between 1000 and 3600000 ms");

  const forkCandidate = dependencies.forkCandidate ?? (fork as ForkCandidate);
  const terminateTree = dependencies.terminateTree ?? terminateProcessTree;
  return new Promise((resolve, reject) => {
    const child = forkCandidate(childPath, [], {
      detached: process.platform !== "win32",
      execArgv: [
        "--experimental-strip-types",
        "--experimental-vm-modules",
        "--disallow-code-generation-from-strings",
      ],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    let settled = false;

    /** Converges success and every failure path on the same tree cleanup. */
    const settle = (
      outcome:
        | { status: "resolve"; result: CandidateBenchmarkResult }
        | { status: "reject"; error: Error }
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      let cleanupFailed = false;
      try {
        if (child.connected) child.disconnect();
      } catch {
        cleanupFailed = true;
      }
      for (const signal of ["SIGTERM", "SIGKILL"] as const) {
        try {
          terminateTree(child.pid, signal);
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed) {
        outcome = {
          status: "reject",
          error: new Error("Candidate process cleanup failed"),
        };
      }
      if (outcome.status === "resolve") resolve(outcome.result);
      else reject(outcome.error);
    };

    const deadline = setTimeout(
      () =>
        settle({
          status: "reject",
          error: new Error(
            `Candidate execution timed out after ${timeoutMs} ms`
          ),
        }),
      timeoutMs
    );
    deadline.unref();
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 16_384)
        stderr += chunk.toString("utf8", 0, 16_384 - stderr.length);
    });
    child.stderr?.once("error", () =>
      settle({
        status: "reject",
        error: new Error("Candidate process diagnostic stream failed"),
      })
    );
    child.once("message", (message: unknown) => {
      try {
        const response = parseChildResponse(message);
        if (response.ok) settle({ status: "resolve", result: response.result });
        else settle({ status: "reject", error: new Error(response.error) });
      } catch (error) {
        settle({
          status: "reject",
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    });
    child.once("error", () =>
      settle({
        status: "reject",
        error: new Error("Candidate process could not start"),
      })
    );
    child.once("exit", (code) => {
      if (!settled)
        settle({
          status: "reject",
          error: new Error(`Candidate child exited ${code}: ${stderr.trim()}`),
        });
    });
    try {
      child.send(request, (error) => {
        if (error)
          settle({
            status: "reject",
            error: new Error("Candidate process request could not be sent"),
          });
      });
    } catch {
      settle({
        status: "reject",
        error: new Error("Candidate process request could not be sent"),
      });
    }
  });
}

const executeCandidateInFreshProcess: CandidateProcessExecutor =
  executeCandidateProcess;

export {
  type CandidateProcessDependencies,
  executeCandidateInFreshProcess,
  executeCandidateProcess,
  type ForkCandidate,
  parseChildResponse,
};
