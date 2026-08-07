import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { inspectCacheArtifact, verifyCacheArtifact } from "./cache.ts";

describe("offline model cache verification", () => {
  it("records file size and SHA-256 identity", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sprig-embedding-cache-")
    );
    const cachePath = path.join(directory, "model.bin");
    const contents = "pinned model fixture";
    await writeFile(cachePath, contents, "utf8");

    await expect(inspectCacheArtifact(cachePath)).resolves.toEqual({
      bytes: Buffer.byteLength(contents),
      checksum: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
    });
  });

  it("refuses a cache whose bytes do not match the configured checksum", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sprig-embedding-cache-")
    );
    const cachePath = path.join(directory, "model.bin");
    await writeFile(cachePath, "unexpected bytes", "utf8");

    await expect(
      verifyCacheArtifact(cachePath, `sha256:${"0".repeat(64)}`)
    ).rejects.toThrow(/checksum mismatch/);
  });
});
