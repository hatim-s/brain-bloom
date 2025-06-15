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

export type NodeData = {
  title: string;
  description?: string;
  link?: string;
};

export type BaseFlowNode = WithRequired<
  Omit<
    Node<NodeData, NodeTypes>,
    | "position" // omitting position since we do not create it, and parentId since we do not need it
    | "parentId" // omitting parentId since it interferes with the computed node positions
  >,
  "id" | "type"
>;

export type FlowNode = BaseFlowNode & Pick<Node, "position">; // add the position to the base node type

export type MindmapNode = Required<Pick<FlowNode, "id">> & {
  // creating a map since we want to access children by id, and maintain order of children
  children: Map<string, MindmapNode>;
  /**
   * The level of the node in the mindmap. Root is level 0, children are level 1, etc.
   */
  level: number;
} & ( // root node does not have a parentId
    | {
        type: NodeTypes.ROOT;
        parentId: null;
      }
    | {
        type: NodeTypes.LEFT | NodeTypes.RIGHT;
        parentId: string;
      }
  );

export type FlowEdge = Edge;

export type MindmapEdge = Edge;
