import { Edge, Node } from "@xyflow/react";

import { WithRequired } from "@/types/helper";

export enum GraphType {
  LEFT = "left",
  RIGHT = "right",
}

export enum NodeTypes {
  ROOT = "root",
  LEFT = "left",
  RIGHT = "right",
}

type NodeTypeParentHelper =
  | {
      type: NodeTypes.ROOT;
      parentId: null;
    }
  | {
      type: NodeTypes.LEFT | NodeTypes.RIGHT;
      parentId: string;
    };

export type BaseFlowNode = WithRequired<
  Omit<
    Node<Record<string, unknown>, NodeTypes>,
    "position" | "parentId" | "type"
  >,
  "id"
> &
  NodeTypeParentHelper;

export type FlowNode = BaseFlowNode & Pick<Node, "position">; // add the position to the base node type

export type MindmapNode = Required<Pick<FlowNode, "id" | "data">> & {
  // creating a map since we want to access children by id, and maintain order of children
  children: Map<string, MindmapNode>;
} & NodeTypeParentHelper;

export type MindmapEdge = Edge;
