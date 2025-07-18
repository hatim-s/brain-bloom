import { NodeProps } from "@xyflow/react";

import BaseNode from "./Node/Node";

export default function RightNode(props: NodeProps) {
  return <BaseNode {...props} direction="right" />;
}
