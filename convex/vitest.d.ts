interface ImportMeta {
  glob(patterns: string | string[]): Record<string, () => Promise<unknown>>;
}
