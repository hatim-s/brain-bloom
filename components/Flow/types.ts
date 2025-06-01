import { Node } from "@xyflow/react";

export type BaseFlowNode = Omit<Node, "position">;
export type FlowNode = Node;
