import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import path from "node:path";

import type { CacheLimits } from "./types.ts";

type CacheMetadata = {
  bytes: number;
  files: number;
  checksum: string;
};

type CacheFile = {
  absolutePath: string;
  relativePath: string;
  bytes: number;
  device: number;
  inode: number;
};

/** Enumerates a bounded real-file tree and rejects every symbolic link. */
async function enumerateCacheFiles(
  rootPath: string,
  limits: CacheLimits
): Promise<CacheFile[]> {
  const rootMetadata = await lstat(rootPath);
  if (rootMetadata.isSymbolicLink()) {
    throw new Error(`Cache root cannot be a symlink: ${rootPath}`);
  }
  if (rootMetadata.isFile()) {
    if (rootMetadata.size > limits.maxBytes) {
      throw new Error(`Cache exceeds maxBytes before hashing: ${rootPath}`);
    }
    return [
      {
        absolutePath: rootPath,
        relativePath: "",
        bytes: rootMetadata.size,
        device: rootMetadata.dev,
        inode: rootMetadata.ino,
      },
    ];
  }
  if (!rootMetadata.isDirectory()) {
    throw new Error(`Cache artifact is not a file or directory: ${rootPath}`);
  }

  const files: CacheFile[] = [];
  let declaredBytes = 0;
  let visitedEntries = 0;

  /** Visits one bounded level while retaining only the configured file ceiling. */
  const visit = async (directoryPath: string, depth: number): Promise<void> => {
    if (depth > limits.maxDepth) {
      throw new Error(`Cache exceeds maxDepth ${limits.maxDepth}`);
    }
    const directory = await opendir(directoryPath);
    const entries = [];
    for await (const entry of directory) {
      visitedEntries += 1;
      if (visitedEntries > limits.maxFiles) {
        throw new Error(`Cache exceeds maxFiles ${limits.maxFiles}`);
      }
      entries.push(entry);
    }

    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      const entryPath = path.join(directoryPath, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Cache symlink is forbidden: ${entryPath}`);
      }
      if (metadata.isDirectory()) {
        await visit(entryPath, depth + 1);
      } else if (metadata.isFile()) {
        files.push({
          absolutePath: entryPath,
          relativePath: path
            .relative(rootPath, entryPath)
            .replaceAll(path.sep, "/"),
          bytes: metadata.size,
          device: metadata.dev,
          inode: metadata.ino,
        });
        declaredBytes += metadata.size;
        if (files.length > limits.maxFiles) {
          throw new Error(`Cache exceeds maxFiles ${limits.maxFiles}`);
        }
        if (declaredBytes > limits.maxBytes) {
          throw new Error(
            `Cache exceeds maxBytes ${limits.maxBytes} before hashing`
          );
        }
      } else {
        throw new Error(`Unsupported cache entry: ${entryPath}`);
      }
    }
  };

  await visit(rootPath, 0);
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

/** Streams a bounded file into the digest and detects growth during hashing. */
async function hashFile(
  hash: ReturnType<typeof createHash>,
  file: CacheFile,
  remainingBytes: number
): Promise<number> {
  let streamedBytes = 0;
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(file.absolutePath, constants.O_RDONLY | noFollow);
  try {
    const openedMetadata = await handle.stat();
    if (
      !openedMetadata.isFile() ||
      openedMetadata.dev !== file.device ||
      openedMetadata.ino !== file.inode ||
      openedMetadata.size !== file.bytes
    ) {
      throw new Error(`Cache changed before hashing: ${file.absolutePath}`);
    }
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      streamedBytes += chunk.length;
      if (streamedBytes > file.bytes || streamedBytes > remainingBytes) {
        throw new Error(
          `Cache changed or exceeded maxBytes while hashing: ${file.absolutePath}`
        );
      }
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }
  if (streamedBytes !== file.bytes) {
    throw new Error(`Cache changed size while hashing: ${file.absolutePath}`);
  }
  return streamedBytes;
}

/** Hashes a cache under hard byte, file-count, depth, and symlink constraints. */
async function inspectCacheArtifact(
  cachePath: string,
  limits: CacheLimits
): Promise<CacheMetadata> {
  const files = await enumerateCacheFiles(cachePath, limits);
  const hash = createHash("sha256");
  let bytes = 0;
  for (const file of files) {
    if (file.relativePath) {
      hash.update(file.relativePath);
      hash.update("\0");
    }
    bytes += await hashFile(hash, file, limits.maxBytes - bytes);
    if (file.relativePath) hash.update("\0");
  }
  return {
    bytes,
    files: files.length,
    checksum: `sha256:${hash.digest("hex")}`,
  };
}

/** Verifies the immutable artifact identity before embeddings are accepted. */
async function verifyCacheArtifact(
  cachePath: string,
  expectedChecksum: string,
  limits: CacheLimits
): Promise<CacheMetadata> {
  const metadata = await inspectCacheArtifact(cachePath, limits);
  if (metadata.checksum !== expectedChecksum) {
    throw new Error(
      `Cache checksum mismatch for ${cachePath}: expected ${expectedChecksum}, received ${metadata.checksum}`
    );
  }
  return metadata;
}

export {
  type CacheMetadata,
  enumerateCacheFiles,
  inspectCacheArtifact,
  verifyCacheArtifact,
};
