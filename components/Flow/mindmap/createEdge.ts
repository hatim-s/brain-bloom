export function createEdge(source: string, target: string) {
  return {
    id: ["e", source, target].join("@"),
    source,
    target,
  };
}
