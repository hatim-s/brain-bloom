import { Handle, NodeProps, Position } from "@xyflow/react";

import { BaseNodeContent } from "./Node";

export default function RootNode(props: NodeProps) {
  const title = props.data.title as string | undefined;
  const description = props.data.description as string | undefined;
  const link = props.data.link as string | undefined;

  const isSelected = props.selected;

  return (
    <>
      <BaseNodeContent
        title={title ?? "Root Node"}
        description={description}
        link={link}
        isSelected={isSelected}
      />
      <Handle
        className="!size-3 !bg-primary !border-primary"
        type="source"
        position={Position.Left}
        id="root-left"
      />
      <Handle
        className="!size-3 !bg-primary !border-primary"
        type="source"
        position={Position.Right}
        id="root-right"
      />
    </>
  );
}
