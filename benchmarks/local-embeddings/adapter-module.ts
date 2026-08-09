import type { EmbeddingAdapterFactory } from "./types.ts";

type AdapterModule = {
  createEmbeddingAdapterFactory?: () =>
    | EmbeddingAdapterFactory
    | Promise<EmbeddingAdapterFactory>;
};

/** Imports an immutable verified byte snapshot instead of reopening its pathname. */
async function loadVerifiedAdapterFactory(
  moduleBytes: Uint8Array,
  moduleChecksum: string
): Promise<EmbeddingAdapterFactory> {
  const sourceUrl = `data:text/javascript;base64,${Buffer.from(moduleBytes).toString("base64")}#${encodeURIComponent(moduleChecksum)}`;
  const imported = (await import(sourceUrl)) as AdapterModule;
  if (!imported.createEmbeddingAdapterFactory)
    throw new Error(
      "Adapter module must export createEmbeddingAdapterFactory as a named function"
    );
  return imported.createEmbeddingAdapterFactory();
}

export { loadVerifiedAdapterFactory };
