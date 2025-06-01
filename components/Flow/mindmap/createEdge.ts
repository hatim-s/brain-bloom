const EDGE_ID_PREFIX = "e";
const EDGE_ID_SEPARATOR = "@";

export const getNewEdgeID = (source: string, target: string) => {
  return [EDGE_ID_PREFIX, source, target].join(EDGE_ID_SEPARATOR);
};

export function createEdge(source: string, target: string) {
  return {
    id: getNewEdgeID(source, target),
    source,
    target,
  };
}
