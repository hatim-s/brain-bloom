import { Handle, NodeProps, Position } from "@xyflow/react";

import { BaseNodeContent } from "./Node/Node";

/**
 * The node every branch grows from.
 *
 * It reads as the root through weight rather than fill: a doubled moss boundary
 * and a moss title over a barely-there wash, so it stays findable when the
 * canvas is zoomed out without turning into a coloured slab up close.
 */
export default function RootNode(props: NodeProps) {
  const title = props.data.title as string | undefined;
  const description = props.data.description as string | undefined;
  const link = props.data.link as string | undefined;

  const isSelected = props.selected;

  return (
    <>
      <BaseNodeContent
        classNames={{
          container: "border-2 border-primary bg-primary/10",
          title: "font-semibold !text-xl text-primary",
        }}
        title={title ?? "Root Node"}
        description={description}
        link={link}
        isSelected={isSelected}
      />
      <Handle type="source" position={Position.Left} id="root-left" />
      <Handle type="source" position={Position.Right} id="root-right" />
    </>
  );
}
