import { Position } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROOT_NODE_ID } from "@/components/flow/const";
import {
  createBaseFlowNodeFromPartialBaseFlowNode,
  getNewNodeID,
  getNodeTypeFromId,
} from "@/components/flow/mindmap/createNode";
import { NodeTypes } from "@/components/flow/types";

describe("getNewNodeID", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [NodeTypes.LEFT, "l-"],
    [NodeTypes.RIGHT, "r-"],
  ])("uses the correct prefix for %s nodes", (type, prefix) => {
    expect(getNewNodeID(type)).toMatch(new RegExp(`^${prefix}`));
  });

  it("does not collide across successive calls for the same node type", () => {
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.2);

    const firstId = getNewNodeID(NodeTypes.LEFT);
    const secondId = getNewNodeID(NodeTypes.LEFT);

    expect(firstId).not.toBe(secondId);
  });
});

describe("getNodeTypeFromId", () => {
  it.each([NodeTypes.LEFT, NodeTypes.RIGHT])(
    "round-trips generated %s node ids",
    (type) => {
      expect(getNodeTypeFromId(getNewNodeID(type))).toBe(type);
    }
  );

  it("returns the root node type for the root node id", () => {
    expect(getNodeTypeFromId(ROOT_NODE_ID)).toBe(NodeTypes.ROOT);
  });
});

describe("createBaseFlowNodeFromPartialBaseFlowNode", () => {
  it("preserves identity and data while applying the current defaults", () => {
    const partialNode = {
      id: "l-topic",
      type: NodeTypes.LEFT,
      data: {
        title: "Topic",
        description: "A detailed description",
        link: "https://example.com",
      },
    };

    const node = createBaseFlowNodeFromPartialBaseFlowNode(partialNode);

    expect(node).toMatchObject(partialNode);
    expect(node.data).toBe(partialNode.data);
    expect(node).toMatchObject({
      selectable: true,
      sourcePosition: Position.Left,
      targetPosition: Position.Right,
      handles: [
        {
          position: Position.Left,
          type: "source",
          x: 0,
          y: 0,
        },
      ],
    });
  });
});
