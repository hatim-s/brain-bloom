import { pathToFileURL } from "node:url";

import type { EmbeddingAdapterFactory } from "./types.ts";

type AdapterModule = {
  createEmbeddingAdapterFactory?: () =>
    | EmbeddingAdapterFactory
    | Promise<EmbeddingAdapterFactory>;
};

/** Imports an already verified absolute adapter module and requires a named factory. */
async function loadVerifiedAdapterFactory(
  absoluteModulePath: string
): Promise<EmbeddingAdapterFactory> {
  const imported = (await import(
    pathToFileURL(absoluteModulePath).href
  )) as AdapterModule;
  if (!imported.createEmbeddingAdapterFactory)
    throw new Error(
      "Adapter module must export createEmbeddingAdapterFactory as a named function"
    );
  return imported.createEmbeddingAdapterFactory();
}

export { loadVerifiedAdapterFactory };
