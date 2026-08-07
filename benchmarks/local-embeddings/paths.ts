import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

type ConfinedPathInspection = {
  path: string;
  exists: boolean;
  kind: "file" | "directory" | "other" | "missing";
  size: number;
};

/** Rejects absolute paths, traversal, empty components, and platform separators. */
function validateRelativePath(relativePath: string, label: string): void {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.includes("\\")
  ) {
    throw new Error(`${label} must be a relative path`);
  }
  const components = relativePath.split("/");
  if (
    components.some(
      (component) => !component || component === "." || component === ".."
    )
  ) {
    throw new Error(
      `${label} must not contain empty, dot, or parent components`
    );
  }
}

/** Resolves a path lexically beneath a dedicated workspace-relative root. */
function resolveConfinedPath(
  workspaceRoot: string,
  dedicatedRootRelative: string,
  entryRelative: string
): { dedicatedRoot: string; targetPath: string } {
  validateRelativePath(dedicatedRootRelative, "Dedicated root");
  validateRelativePath(entryRelative, "Configured path");
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const dedicatedRoot = path.resolve(resolvedWorkspace, dedicatedRootRelative);
  const targetPath = path.resolve(dedicatedRoot, entryRelative);
  if (!targetPath.startsWith(`${dedicatedRoot}${path.sep}`)) {
    throw new Error("Configured path escapes its dedicated root");
  }
  return { dedicatedRoot, targetPath };
}

/** Walks every controlled component with lstat so symlinks are never followed. */
async function inspectConfinedPath(
  workspaceRoot: string,
  dedicatedRootRelative: string,
  entryRelative: string
): Promise<ConfinedPathInspection> {
  const { targetPath } = resolveConfinedPath(
    workspaceRoot,
    dedicatedRootRelative,
    entryRelative
  );
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const relativeTarget = path.relative(resolvedWorkspace, targetPath);
  const components = relativeTarget.split(path.sep);
  let currentPath = resolvedWorkspace;

  const workspaceMetadata = await lstat(currentPath);
  if (workspaceMetadata.isSymbolicLink() || !workspaceMetadata.isDirectory()) {
    throw new Error("Workspace root must be a real directory, not a symlink");
  }

  for (let index = 0; index < components.length; index += 1) {
    currentPath = path.join(currentPath, components[index]);
    try {
      const metadata = await lstat(currentPath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Symlink path component is forbidden: ${currentPath}`);
      }
      if (index < components.length - 1 && !metadata.isDirectory()) {
        throw new Error(`Path ancestor is not a directory: ${currentPath}`);
      }
      if (index === components.length - 1) {
        return {
          path: targetPath,
          exists: true,
          kind: metadata.isFile()
            ? "file"
            : metadata.isDirectory()
              ? "directory"
              : "other",
          size: metadata.size,
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { path: targetPath, exists: false, kind: "missing", size: 0 };
      }
      throw error;
    }
  }
  throw new Error("Configured path did not contain a resolvable component");
}

/** Creates missing controlled directories one at a time without following links. */
async function ensureConfinedDirectory(
  workspaceRoot: string,
  dedicatedRootRelative: string,
  entryRelative: string
): Promise<string> {
  const { targetPath } = resolveConfinedPath(
    workspaceRoot,
    dedicatedRootRelative,
    entryRelative
  );
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const components = path
    .relative(resolvedWorkspace, targetPath)
    .split(path.sep);
  let currentPath = resolvedWorkspace;

  const workspaceMetadata = await lstat(currentPath);
  if (workspaceMetadata.isSymbolicLink() || !workspaceMetadata.isDirectory()) {
    throw new Error("Workspace root must be a real directory, not a symlink");
  }

  for (const component of components) {
    currentPath = path.join(currentPath, component);
    try {
      const metadata = await lstat(currentPath);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(`Output directory component is unsafe: ${currentPath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(currentPath);
    }
  }
  return targetPath;
}

/** Atomically replaces a regular report file while refusing destination links. */
async function safeWriteFile(
  directoryPath: string,
  filename: string,
  contents: string
): Promise<void> {
  validateRelativePath(filename, "Report filename");
  const directoryMetadata = await lstat(directoryPath);
  if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()) {
    throw new Error(`Report directory is unsafe: ${directoryPath}`);
  }
  const destinationPath = path.join(directoryPath, filename);
  try {
    const metadata = await lstat(destinationPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`Report destination is unsafe: ${destinationPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporaryPath = path.join(
    directoryPath,
    `.${filename}.${process.pid}.${randomUUID()}.tmp`
  );
  const handle = await open(temporaryPath, "wx", 0o600);
  let handleClosed = false;
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    handleClosed = true;
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  } finally {
    if (!handleClosed) await handle.close();
  }

  try {
    try {
      const metadata = await lstat(destinationPath);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error(`Report destination became unsafe: ${destinationPath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Rename replaces the directory entry itself and never follows its target.
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export {
  type ConfinedPathInspection,
  ensureConfinedDirectory,
  inspectConfinedPath,
  resolveConfinedPath,
  safeWriteFile,
  validateRelativePath,
};
