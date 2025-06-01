import { Node, Position } from "@xyflow/react";

const getNewNodeID = (type: "left" | "right") => {
  return [type, Math.random().toString(36).substring(2, 15)].join("-");
};

export function createNode(type: "left" | "right", title: string) {
  return {
    id: getNewNodeID(type),
    type: type,
    data: { title: title },
    handles: [
      {
        position: Position.Left,
        type: "source",
        x: 0,
        y: 0,
      },
    ],
    sourcePosition: Position.Left,
    targetPosition: Position.Right,
  } as Omit<Node, "position">;
}
