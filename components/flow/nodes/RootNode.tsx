import { Handle, NodeProps, Position } from "@xyflow/react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useMindmapFlow } from "../providers/MindmapFlowProvider";
import {
  BaseNodeContent,
  getPopoverSurface,
  NODE_CARD_RADIUS,
} from "./Node/Node";
import { NodeAiPrompt } from "./Node/NodeAiPrompt";
import { NodeContextToolbar } from "./Node/NodeContextToolbar";

/**
 * The node every branch grows from — the grove's heart.
 *
 * It reads as the root through presence rather than fill: the widest card, the
 * softest and symmetric 18px corners, a moss title, a moss hairline, and a
 * whisper of moss canopy light over the card surface. All of that geometry and
 * warmth lives in `BaseNodeContent` under the "root" hemisphere, so the root and
 * the branches can never drift apart.
 *
 * Its title is the map's name (renamed from the header or by the model), so
 * the toolbar offers the AI verbs but not the field editor.
 */
export default function RootNode(props: NodeProps) {
  const title = props.data.title as string | undefined;
  const description = props.data.description as string | undefined;
  const link = props.data.link as string | undefined;

  const isSelected = props.selected;

  const aiEditNode = useMindmapFlow((state) => state.aiEditNode);
  const toolbarNode = useMindmapFlow((state) => state.toolbarNode);
  const readOnly = useMindmapFlow((state) => state.readOnly);

  const surface = getPopoverSurface({
    isAiEditing: aiEditNode === props.id,
    isEditing: false,
    isToolbarOpen: toolbarNode === props.id,
  });

  return (
    <Popover open={!readOnly && surface !== null}>
      {/* The trigger carries the card's own corner so the focus ring and the AI
          bloom hug the sheet instead of boxing it. */}
      <PopoverTrigger className={NODE_CARD_RADIUS.root}>
        <BaseNodeContent
          nodeId={props.id}
          title={title ?? "Root Node"}
          description={description}
          link={link}
          isSelected={isSelected}
          hemisphere="root"
        />
      </PopoverTrigger>
      <Handle type="source" position={Position.Left} id="root-left" />
      <Handle type="source" position={Position.Right} id="root-right" />
      {readOnly ? null : (
        <>
          <PopoverContent
            className={cn(
              "w-auto rounded-[12px] p-1",
              surface === "toolbar" ? "" : "hidden"
            )}
            onOpenAutoFocus={(event) => event.preventDefault()}
            side="top"
            sideOffset={8}
          >
            <NodeContextToolbar canEditFields={false} nodeId={props.id} />
          </PopoverContent>
          <PopoverContent
            className={cn(
              "w-[360px] rounded-[16px] !p-0",
              surface === "prompt" ? "" : "hidden"
            )}
            side="bottom"
            sideOffset={10}
          >
            <NodeAiPrompt />
          </PopoverContent>
        </>
      )}
    </Popover>
  );
}
