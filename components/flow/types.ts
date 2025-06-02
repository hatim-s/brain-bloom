import { Node } from "@xyflow/react";

export enum GraphType {
  LEFT = "left",
  RIGHT = "right",
}

export enum NodeTypes {
  ROOT = "root",
  LEFT = "left",
  RIGHT = "right",
}

export type BaseFlowNode = Omit<Node, "position">;
export type FlowNode = Node<Record<string, unknown>, NodeTypes>;
