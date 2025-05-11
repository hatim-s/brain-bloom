import { NodeProps } from "@xyflow/react";
import BaseNode from "./Node";

export default function LeftNode(props: NodeProps) {
  return <BaseNode {...props} direction="left" />;
}
