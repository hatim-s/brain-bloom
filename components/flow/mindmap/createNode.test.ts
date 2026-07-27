import { Position } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROOT_NODE_ID } from "@/components/flow/const";
import {
  createBaseFlowNodeFromPartialBaseFlowNode,
  getNewNodeID,
  getNodeSourceHandles,
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

  it("preserves the current empty suffix and collision when randomness is zero", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const firstId = getNewNodeID(NodeTypes.LEFT);
    const secondId = getNewNodeID(NodeTypes.LEFT);

    // KNOWN BUG (P3): zero produces no five-character suffix, so both ids are bare
    // prefixes and collide. P3 will harden node id generation.
    expect(firstId).toBe("l-");
    expect(secondId).toBe("l-");
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
    expect(node.data).toEqual(partialNode.data);
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

  it("applies right-node handles and positions", () => {
    const partialNode = {
      id: "r-topic",
      type: NodeTypes.RIGHT,
      data: {
        title: "Topic",
      },
    };

    expect(
      createBaseFlowNodeFromPartialBaseFlowNode(partialNode)
    ).toMatchObject({
      ...partialNode,
      selectable: true,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      handles: [
        {
          position: Position.Right,
          type: "source",
          x: 0,
          y: 0,
        },
      ],
    });
  });

  it("applies root handles without left or right node positions", () => {
    const partialNode = {
      id: ROOT_NODE_ID,
      type: NodeTypes.ROOT,
      data: {
        title: "Root",
      },
    };

    const node = createBaseFlowNodeFromPartialBaseFlowNode(partialNode);

    expect(node).toMatchObject({
      ...partialNode,
      selectable: true,
      handles: [
        {
          id: "root-left",
          position: Position.Left,
          type: "source",
          x: 0,
          y: 0,
        },
        {
          id: "root-right",
          position: Position.Right,
          type: "source",
          x: 0,
          y: 0,
        },
      ],
    });
    expect(node).not.toHaveProperty("sourcePosition");
    expect(node).not.toHaveProperty("targetPosition");
  });
});

describe("getNodeSourceHandles", () => {
  it("defines the root handle ids consumed by root edges", () => {
    expect(getNodeSourceHandles(NodeTypes.ROOT)).toMatchObject({
      handles: [{ id: "root-left" }, { id: "root-right" }],
    });
  });
});
