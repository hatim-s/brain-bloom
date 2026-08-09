import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ensureConfinedDirectory,
  inspectConfinedPath,
  resolveConfinedPath,
  safeWriteFile,
} from "./paths.ts";

describe("benchmark filesystem confinement", () => {
  it("rejects absolute and parent-traversal paths", () => {
    expect(() =>
      resolveConfinedPath("/tmp/work", "cache", "/etc/passwd")
    ).toThrow(/relative path/);
    expect(() =>
      resolveConfinedPath("/tmp/work", "cache", "../escape")
    ).toThrow(/parent components/);
  });

  it("rejects symlink roots and ancestors before resolving cache paths", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "sprig-paths-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "sprig-outside-"));
    await symlink(outside, path.join(workspace, "cache"));

    await expect(
      inspectConfinedPath(workspace, "cache/models", "candidate")
    ).rejects.toThrow(/Symlink path component/);
  });

  it("writes regular reports atomically and refuses output symlinks", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "sprig-paths-"));
    const output = await ensureConfinedDirectory(
      workspace,
      "reports",
      "comparison"
    );
    await safeWriteFile(output, "comparison.json", "safe");
    await expect(
      readFile(path.join(output, "comparison.json"), "utf8")
    ).resolves.toBe("safe");

    const outside = path.join(workspace, "outside.txt");
    await writeFile(outside, "do not overwrite", "utf8");
    await symlink(outside, path.join(output, "comparison.md"));
    await expect(
      safeWriteFile(output, "comparison.md", "unsafe")
    ).rejects.toThrow(/destination is unsafe/);
    await expect(readFile(outside, "utf8")).resolves.toBe("do not overwrite");
  });

  it("refuses a symlinked output directory", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "sprig-paths-"));
    const realOutput = path.join(workspace, "real");
    const linkedOutput = path.join(workspace, "linked");
    await mkdir(realOutput);
    await symlink(realOutput, linkedOutput);

    await expect(
      ensureConfinedDirectory(workspace, "linked", "nested")
    ).rejects.toThrow(/unsafe/);
    await expect(
      safeWriteFile(linkedOutput, "report.json", "unsafe")
    ).rejects.toThrow(/directory is unsafe/);
  });
});
