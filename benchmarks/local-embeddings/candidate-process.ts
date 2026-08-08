import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  CandidateProcessExecutor,
  CandidateProcessRequest,
} from "./runner.ts";
import type { CandidateBenchmarkResult } from "./types.ts";

type ChildResponse =
  | { ok: true; result: CandidateBenchmarkResult }
  | { ok: false; error: string };

const childPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "candidate-child.ts"
);

/** Executes exactly one candidate in a new process and caps diagnostic output. */
const executeCandidateInFreshProcess: CandidateProcessExecutor = async (
  request: CandidateProcessRequest
) =>
  new Promise((resolve, reject) => {
    const child = fork(childPath, [], {
      execArgv: ["--experimental-strip-types"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    let receivedResponse = false;
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 16_384)
        stderr += chunk.toString("utf8", 0, 16_384 - stderr.length);
    });
    child.once("message", (message: ChildResponse) => {
      receivedResponse = true;
      child.disconnect();
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error));
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!receivedResponse)
        reject(new Error(`Candidate child exited ${code}: ${stderr.trim()}`));
    });
    child.send(request);
  });

export { executeCandidateInFreshProcess };
