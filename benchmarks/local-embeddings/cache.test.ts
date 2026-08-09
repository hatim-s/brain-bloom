import { createHash } from "node:crypto";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { inspectCacheArtifact, verifyCacheArtifact } from "./cache.ts";
import type { CacheLimits } from "./types.ts";

const generousLimits: CacheLimits = {
  maxBytes: 1_000_000,
  maxFiles: 100,
  maxDepth: 5,
};

describe("offline model cache verification", () => {
  it("records file size and SHA-256 identity by streaming", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sprig-cache-"));
    const cachePath = path.join(directory, "model.bin");
    const contents = "pinned model fixture";
    await writeFile(cachePath, contents, "utf8");

    await expect(
      inspectCacheArtifact(cachePath, generousLimits)
    ).resolves.toEqual({
      bytes: Buffer.byteLength(contents),
      files: 1,
      checksum: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
    });
  });

  it("hashes Unicode filenames in locale-independent code-unit order", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sprig-cache-"));
    const files = [
      ["Ω.bin", "omega"],
      ["ä.bin", "umlaut"],
      ["Z.bin", "upper"],
    ] as const;
    await Promise.all(
      files.map(([filename, contents]) =>
        writeFile(path.join(directory, filename), contents, "utf8")
      )
    );
    const expected = createHash("sha256");
    for (const [filename, contents] of [files[2], files[1], files[0]]) {
      expected.update(filename).update("\0").update(contents).update("\0");
    }

    await expect(
      inspectCacheArtifact(directory, generousLimits)
    ).resolves.toMatchObject({
      checksum: `sha256:${expected.digest("hex")}`,
    });
  });

  it("refuses a cache whose bytes do not match the configured checksum", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sprig-cache-"));
    const cachePath = path.join(directory, "model.bin");
    await writeFile(cachePath, "unexpected bytes", "utf8");

    await expect(
      verifyCacheArtifact(cachePath, `sha256:${"0".repeat(64)}`, generousLimits)
    ).rejects.toThrow(/checksum mismatch/);
  });

  it("rejects symlink roots and entries instead of skipping model blobs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sprig-cache-"));
    const outside = path.join(directory, "outside.bin");
    const cache = path.join(directory, "cache");
    await writeFile(outside, "weights", "utf8");
    await mkdir(cache);
    await symlink(outside, path.join(cache, "model.bin"));

    await expect(inspectCacheArtifact(cache, generousLimits)).rejects.toThrow(
      /symlink is forbidden/
    );
    await expect(
      inspectCacheArtifact(path.join(cache, "model.bin"), generousLimits)
    ).rejects.toThrow(/root cannot be a symlink/);
  });

  it("rejects byte, file-count, and depth limits before unbounded work", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sprig-cache-"));
    await writeFile(
      path.join(directory, "large.bin"),
      "too many bytes",
      "utf8"
    );
    await expect(
      inspectCacheArtifact(directory, { ...generousLimits, maxBytes: 2 })
    ).rejects.toThrow(/maxBytes/);

    await writeFile(path.join(directory, "second.bin"), "x", "utf8");
    await expect(
      inspectCacheArtifact(directory, { ...generousLimits, maxFiles: 1 })
    ).rejects.toThrow(/maxFiles/);

    const nested = path.join(directory, "one", "two");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "deep.bin"), "x", "utf8");
    await expect(
      inspectCacheArtifact(directory, { ...generousLimits, maxDepth: 1 })
    ).rejects.toThrow(/maxDepth/);
  });
});
