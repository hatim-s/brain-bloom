import { describe, expect, it } from "vitest";

import { transformConvexNodesToFlowNodesAndEdges } from "./mindmapNodesToFlowNodes";

describe("transformConvexNodesToFlowNodesAndEdges", () => {
  it("returns an empty graph for empty or rootless Convex snapshots", () => {
    expect(transformConvexNodesToFlowNodesAndEdges([])).toEqual({
      nodes: [],
      edges: [],
    });
    expect(
      transformConvexNodesToFlowNodesAndEdges([
        {
          nodeId: "left-1",
          parentId: "root",
          type: "left",
          title: "Orphaned idea",
          order: 0,
        },
      ])
    ).toEqual({ nodes: [], edges: [] });
  });
});
