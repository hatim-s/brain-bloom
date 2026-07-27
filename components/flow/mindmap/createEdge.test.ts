import { describe, expect, it } from "vitest";

import { ROOT_NODE_ID } from "@/components/flow/const";
import {
  createEdge,
  createFlowEdgeFromPartialBaseFlowEdge,
} from "@/components/flow/mindmap/createEdge";

describe("createEdge", () => {
  it("derives a stable, unique id from the source and target", () => {
    const edge = createEdge("l-parent", "l-child");
    const repeatedEdge = createEdge("l-parent", "l-child");
    const differentEdge = createEdge("l-parent", "l-sibling");

    expect(edge.id).toBe("e@l-parent@l-child");
    expect(repeatedEdge.id).toBe(edge.id);
    expect(differentEdge.id).not.toBe(edge.id);
  });

  it("assigns source and target in the requested direction", () => {
    const edge = createEdge("l-parent", "l-child");

    expect(edge).toMatchObject({
      source: "l-parent",
      target: "l-child",
    });
  });

  it("anchors an edge from the root to a left target on the left handle", () => {
    const edge = createEdge(ROOT_NODE_ID, "l-child");

    expect(edge.sourceHandle).toBe("root-left");
  });

  it("anchors an edge from the root to a right target on the right handle", () => {
    const edge = createEdge(ROOT_NODE_ID, "r-child");

    expect(edge.sourceHandle).toBe("root-right");
  });

  it("does not assign a root source handle to a non-root edge", () => {
    const edge = createEdge("l-parent", "l-child");

    // The helper returns null for non-root sources, so spreading it leaves no property.
    expect(edge.sourceHandle).toBeUndefined();
  });
});

describe("createFlowEdgeFromPartialBaseFlowEdge", () => {
  it("preserves the identity fields of the partial edge", () => {
    const partialEdge = {
      id: "e@l-parent@l-child",
      source: "l-parent",
      target: "l-child",
    };

    expect(createFlowEdgeFromPartialBaseFlowEdge(partialEdge)).toMatchObject(
      partialEdge
    );
  });
});
