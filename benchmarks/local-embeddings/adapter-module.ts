import { isBuiltin } from "node:module";

import ts from "typescript";

import type {
  AdapterBundleContract,
  EmbeddingAdapterFactory,
} from "./types.ts";

type AdapterModule = {
  createEmbeddingAdapterFactory?: () =>
    | EmbeddingAdapterFactory
    | Promise<EmbeddingAdapterFactory>;
};

/** Rejects dependency-loading syntax that cannot stay inside verified bytes. */
function validateSelfContainedAdapterBundle(
  moduleBytes: Uint8Array,
  bundle: AdapterBundleContract
): void {
  if (bundle.format !== "self-contained-esm-bundle/v1")
    throw new Error(`Unsupported adapter bundle contract: ${bundle.format}`);
  const sourceFile = ts.createSourceFile(
    "adapter-bundle.mjs",
    Buffer.from(moduleBytes).toString("utf8"),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics.length > 0)
    throw new Error("Adapter bundle is not valid JavaScript");

  const staticSpecifiers: string[] = [];
  let dynamicImportFound = false;
  let requireCallFound = false;
  /** Traverses parsed syntax so comments and strings cannot spoof validation. */
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      staticSpecifiers.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
        dynamicImportFound = true;
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      )
        requireCallFound = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (dynamicImportFound)
    throw new Error("Adapter bundle dynamic import() is forbidden");
  if (requireCallFound)
    throw new Error("Adapter bundle require() is forbidden");

  const allowedBuiltins = new Set(bundle.allowedNodeBuiltins);
  for (const specifier of staticSpecifiers) {
    if (!specifier.startsWith("node:"))
      throw new Error(
        `Adapter bundle import "${specifier}" is forbidden; bundle dependencies into the verified single file`
      );
    if (!isBuiltin(specifier) || specifier === "node:module")
      throw new Error(`Adapter bundle builtin "${specifier}" is unsupported`);
    if (!allowedBuiltins.has(specifier))
      throw new Error(
        `Adapter bundle import "${specifier}" is not declared in its manifest`
      );
  }
}

/** Imports one validated immutable bundle snapshot and constructs its factory. */
async function loadVerifiedAdapterFactory(
  moduleBytes: Uint8Array,
  moduleChecksum: string,
  bundle: AdapterBundleContract
): Promise<EmbeddingAdapterFactory> {
  validateSelfContainedAdapterBundle(moduleBytes, bundle);
  const sourceUrl = `data:text/javascript;base64,${Buffer.from(moduleBytes).toString("base64")}#${encodeURIComponent(moduleChecksum)}`;
  const imported = (await import(sourceUrl)) as AdapterModule;
  if (!imported.createEmbeddingAdapterFactory)
    throw new Error(
      "Adapter module must export createEmbeddingAdapterFactory as a named function"
    );
  return imported.createEmbeddingAdapterFactory();
}

export { loadVerifiedAdapterFactory, validateSelfContainedAdapterBundle };
