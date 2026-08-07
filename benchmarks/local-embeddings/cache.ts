import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

type CacheMetadata = {
  bytes: number;
  checksum: string;
};

/** Walks cache files in lexical order so directory checksums are reproducible. */
async function listFiles(
  rootPath: string,
  currentPath = rootPath
): Promise<string[]> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(rootPath, entryPath)));
    } else if (entry.isFile()) {
      files.push(path.relative(rootPath, entryPath));
    }
  }
  return files;
}

/** Hashes a file, or a directory including stable relative names and contents. */
async function inspectCacheArtifact(cachePath: string): Promise<CacheMetadata> {
  const cacheStat = await stat(cachePath);
  const hash = createHash("sha256");
  let bytes = 0;

  if (cacheStat.isFile()) {
    const contents = await readFile(cachePath);
    hash.update(contents);
    bytes = contents.byteLength;
  } else if (cacheStat.isDirectory()) {
    for (const relativePath of await listFiles(cachePath)) {
      const contents = await readFile(path.join(cachePath, relativePath));
      // Names are part of the digest to prevent artifact-file substitution.
      hash.update(relativePath.replaceAll(path.sep, "/"));
      hash.update("\0");
      hash.update(contents);
      hash.update("\0");
      bytes += contents.byteLength;
    }
  } else {
    throw new Error(`Cache artifact is not a file or directory: ${cachePath}`);
  }

  return { bytes, checksum: `sha256:${hash.digest("hex")}` };
}

/** Verifies the immutable artifact identity before embeddings are accepted. */
async function verifyCacheArtifact(
  cachePath: string,
  expectedChecksum: string
): Promise<CacheMetadata> {
  const metadata = await inspectCacheArtifact(cachePath);
  if (metadata.checksum !== expectedChecksum) {
    throw new Error(
      `Cache checksum mismatch for ${cachePath}: expected ${expectedChecksum}, received ${metadata.checksum}`
    );
  }
  return metadata;
}

export { type CacheMetadata, inspectCacheArtifact, verifyCacheArtifact };
