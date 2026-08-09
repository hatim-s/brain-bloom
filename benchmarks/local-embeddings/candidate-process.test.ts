import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { executeCandidateProcess } from "./candidate-process.ts";
import type { CandidateProcessRequest } from "./runner.ts";
import type { CandidateBenchmarkResult } from "./types.ts";

/** Creates the minimum evented child boundary needed for lifecycle tests. */
function createFakeChild() {
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperties(child, {
    connected: { value: true, writable: true },
    pid: { value: 4242 },
    stderr: { value: new PassThrough() },
  });
  child.disconnect = vi.fn(() => {
    Object.defineProperty(child, "connected", { value: false, writable: true });
    return child;
  });
  child.send = vi.fn((_message, callback) => {
    if (typeof callback === "function") callback(null);
    return true;
  }) as ChildProcess["send"];
  return child;
}

const request = {
  configuration: {
    measurement: { candidateTimeoutMs: 1_000 },
  },
} as CandidateProcessRequest;
const result = {
  candidate: { key: "candidate-a" },
} as CandidateBenchmarkResult;

describe("isolated candidate process lifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it("times out a non-responsive child and terminates its process group", async () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    const terminateTree = vi.fn();
    const pending = executeCandidateProcess(request, {
      forkCandidate: () => child,
      terminateTree,
    });
    const rejection = expect(pending).rejects.toThrow(
      /timed out after 1000 ms/
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(terminateTree).toHaveBeenCalledWith(4242, "SIGTERM");
    expect(terminateTree).toHaveBeenCalledWith(4242, "SIGKILL");
    expect(child.disconnect).toHaveBeenCalledOnce();
  });

  it("rejects an exit before response through the same cleanup", async () => {
    const child = createFakeChild();
    const terminateTree = vi.fn();
    const pending = executeCandidateProcess(request, {
      forkCandidate: () => child,
      terminateTree,
    });
    child.emit("exit", 2);

    await expect(pending).rejects.toThrow(/exited 2/);
    expect(terminateTree).toHaveBeenCalledWith(4242, "SIGTERM");
  });

  it("rejects child errors and ignores later duplicate terminal events", async () => {
    const child = createFakeChild();
    const terminateTree = vi.fn();
    const pending = executeCandidateProcess(request, {
      forkCandidate: () => child,
      terminateTree,
    });
    child.emit("error", new Error("spawn failed"));
    child.emit("exit", 1);

    await expect(pending).rejects.toThrow(/could not start/);
    expect(terminateTree).toHaveBeenCalledTimes(2);
  });

  it("cleans up when IPC request delivery fails", async () => {
    const child = createFakeChild();
    child.send = vi.fn(() => {
      throw new Error("closed channel");
    }) as ChildProcess["send"];
    const terminateTree = vi.fn();

    await expect(
      executeCandidateProcess(request, {
        forkCandidate: () => child,
        terminateTree,
      })
    ).rejects.toThrow(/could not be sent/);
    expect(terminateTree).toHaveBeenCalledWith(4242, "SIGTERM");
  });

  it("returns the first response and cleans up before a later exit", async () => {
    const child = createFakeChild();
    const terminateTree = vi.fn();
    const pending = executeCandidateProcess(request, {
      forkCandidate: () => child,
      terminateTree,
    });
    child.emit("message", { ok: true, result });
    child.emit("exit", 0);

    await expect(pending).resolves.toBe(result);
    expect(terminateTree).toHaveBeenCalledTimes(2);
  });

  it("starts the candidate child with the constrained VM module boundary", async () => {
    const child = createFakeChild();
    const forkCandidate = vi.fn(() => child);
    const pending = executeCandidateProcess(request, {
      forkCandidate,
      terminateTree: vi.fn(),
    });
    child.emit("message", { ok: true, result });
    await pending;

    expect(forkCandidate).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({
        execArgv: [
          "--experimental-strip-types",
          "--experimental-vm-modules",
          "--disallow-code-generation-from-strings",
        ],
      })
    );
  });
});
