import { describe, expect, it } from "vitest";

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
    expect(edge).not.toMatchObject({
      source: "l-child",
      target: "l-parent",
    });
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
