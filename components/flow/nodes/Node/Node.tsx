import {
  Handle,
  NodeProps,
  Position,
  useUpdateNodeInternals,
} from "@xyflow/react";
import { LinkIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Stack } from "@/components/ui/stack";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { useMindmapFlow } from "../../providers/MindmapFlowProvider";
import { NodeAiPrompt } from "./NodeAiPrompt";
import { NodeContextToolbar } from "./NodeContextToolbar";
import { NodeDataInput } from "./NodeDataInput";

/** Which side of the grove a card grew into; the root is the still centre. */
type NodeHemisphere = "left" | "right" | "root";

/**
 * Leaf-corner rounding, mirrored per hemisphere.
 *
 * Three corners open up generously; the one corner pointing back down the stem
 * toward the root pinches in, so a card reads as something that grew out of the
 * middle rather than a rectangle dropped on the canvas. The root, having no
 * stem behind it, stays symmetric and softest.
 */
const NODE_CARD_RADIUS: Record<NodeHemisphere, string> = {
  root: "rounded-[18px]",
  right: "rounded-[16px] rounded-tl-[5px]",
  left: "rounded-[16px] rounded-tr-[5px]",
};

/**
 * Depth-scaled geometry, so the map reads like growth: root largest, leaves
 * smallest, each step quieter than the one it hangs off.
 *
 * BINDING CONTRACT — the radial layout engine estimates card boxes from exactly
 * these numbers (width, vertical padding, title line-height, two description
 * lines). Index 0 is the root; index 3 covers depth 3 and everything deeper.
 * Nothing here may drift without the layout estimator moving with it, and there
 * is deliberately no gap between title and description because the estimator
 * does not reserve one.
 */
const DEPTH_SCALE = [
  {
    // depth 0 — the grove's heart: 320 wide, 16px vertical padding, 30px title.
    card: "w-[320px] px-[22px] py-4",
    title: "text-[22px] leading-[30px]",
    description: "text-[15px] leading-[24px]",
  },
  {
    // depth 1 — first branches: 300 wide, 14px vertical padding, 26px title.
    card: "w-[300px] px-5 py-3.5",
    title: "text-[19px] leading-[26px]",
    description: "text-[15px] leading-[24px]",
  },
  {
    // depth 2 — 264 wide, 12px vertical padding, 24px title, tighter body.
    card: "w-[264px] px-[18px] py-3",
    title: "text-[17px] leading-[24px]",
    description: "text-[13px] leading-[21px]",
  },
  {
    // depth 3+ — leaves: 236 wide, 10px vertical padding, 21px title.
    card: "w-[236px] px-4 py-2.5",
    title: "text-[15px] leading-[21px]",
    description: "text-[13px] leading-[21px]",
  },
] as const;

/** Clamps a node's level onto the four rungs of the depth scale. */
function getDepthScale(depth: number): (typeof DEPTH_SCALE)[number] {
  const index = Math.min(Math.max(depth, 0), DEPTH_SCALE.length - 1);
  return DEPTH_SCALE[index];
}

/**
 * The card that every mindmap node renders into.
 *
 * A lit clearing on the forest ground: raised surface, hairline-strong
 * boundary, rest shadow lifting to raised on hover, leaf-corner rounding
 * mirrored by hemisphere. Selection is a moss ring held off the card by a 2px
 * gap in the canvas colour (drawn in flow.css via `data-selected`), so it reads
 * at any zoom without thickening the card's own border.
 *
 * The root wears its size rather than shouting: the widest box, the softest
 * corners, a moss title over a whisper of moss canopy light, and a moss
 * hairline — warmth, not a coloured slab.
 *
 * The box model here is load-bearing; see DEPTH_SCALE.
 */
const BaseNodeContent = (props: {
  /** Store id, used to read this node's level for the depth scale. */
  nodeId: string;
  title: string;
  description?: string | undefined;
  link?: string | undefined;
  isSelected: boolean;
  hemisphere: NodeHemisphere;
}) => {
  const { nodeId, title, description, link, isSelected, hemisphere } = props;

  const level = useMindmapFlow(
    (state) => state.mindmapNodesMap[nodeId]?.level ?? 1
  );
  const isRoot = hemisphere === "root";
  const depth = isRoot ? 0 : level;
  const scale = getDepthScale(depth);

  return (
    <Stack
      className={cn(
        "sprig-node-card relative isolate items-start text-left",
        "border bg-card text-card-foreground",
        scale.card,
        NODE_CARD_RADIUS[hemisphere],
        // The heart gets a moss hairline; branches keep the actionable-object line.
        isRoot ? "border-primary/45" : "border-line-strong",
        "transition-[border-color,box-shadow] duration-200 ease-settle motion-reduce:transition-none"
      )}
      data-selected={isSelected || undefined}
      // Hook for flow.css to rest the heart one step higher than its branches;
      // shadows live there because the canvas stylesheet owns card elevation.
      data-root={isRoot || undefined}
      direction="column"
    >
      {isRoot ? (
        // Warmth, not a coloured slab: a barely-there moss wash over the card
        // surface. It sits behind the text (negative z inside the card's own
        // stacking context, the same trick `.sprig-atmosphere` uses) and takes
        // the card's corners with it.
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] bg-primary/[0.06]"
        />
      ) : null}
      {/* One line, always: `layout/nodeSize.ts` reserves exactly one title line
          per card, so a long title ellipses here rather than pushing the card
          taller than the grove reserved for it. */}
      <Typography
        className={cn(
          "line-clamp-1 flex-1 font-semibold tracking-[-0.01em]",
          scale.title,
          isRoot && "text-primary"
        )}
        variant="h4"
      >
        {title}
      </Typography>
      {description ? (
        <Typography
          className={cn(
            "line-clamp-2 flex-1 text-muted-foreground",
            scale.description
          )}
          variant="p"
        >
          {description}
        </Typography>
      ) : null}
      {link ? (
        <Link
          href={link}
          target="_blank"
          className="absolute right-1.5 top-1.5 text-xs"
        >
          <Button
            className="!size-7 text-muted-foreground hover:text-primary [&_svg]:!size-3.5"
            variant="ghost"
            size="icon"
          >
            <LinkIcon />
          </Button>
        </Link>
      ) : null}
    </Stack>
  );
};

/**
 * The three surfaces the node popover can hold, and which one applies.
 *
 * Priority runs prompt > editor > toolbar so a deliberate deeper state is
 * never covered by the lighter chrome that opened it.
 */
function getPopoverSurface({
  isAiEditing,
  isEditing,
  isToolbarOpen,
}: {
  isAiEditing: boolean;
  isEditing: boolean;
  isToolbarOpen: boolean;
}): "prompt" | "editor" | "toolbar" | null {
  if (isAiEditing) return "prompt";
  if (isEditing) return "editor";
  if (isToolbarOpen) return "toolbar";
  return null;
}

/** Renders an editable branch node with source and target flow handles. */
const BaseNode = (props: NodeProps & { direction: "left" | "right" }) => {
  const title = props.data.title as string | undefined;
  const description = props.data.description as string | undefined;
  const link = props.data.link as string | undefined;

  const isSelected = props.selected;

  const sourcePosition =
    props.direction === "left" ? Position.Left : Position.Right;
  const targetPosition =
    props.direction === "left" ? Position.Right : Position.Left;

  const selectedNode = useMindmapFlow((state) => state.selectedNode);
  const aiEditNode = useMindmapFlow((state) => state.aiEditNode);
  const toolbarNode = useMindmapFlow((state) => state.toolbarNode);
  const readOnly = useMindmapFlow((state) => state.readOnly);
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    // Radix finalizes the trigger subtree after XYFlow's first node measurement.
    // Re-measure once mounted so the source and target bounds become available.
    updateNodeInternals(props.id);
  }, [props.id, updateNodeInternals]);

  const surface = getPopoverSurface({
    isAiEditing: aiEditNode === props.id,
    isEditing: selectedNode === props.id,
    isToolbarOpen: toolbarNode === props.id,
  });

  return (
    <Popover open={!readOnly && surface !== null}>
      {/* The trigger carries the card's own leaf corners so the focus ring and
          the AI bloom hug the sheet instead of boxing it. */}
      <PopoverTrigger className={NODE_CARD_RADIUS[props.direction]}>
        <BaseNodeContent
          nodeId={props.id}
          title={title ?? "Node"}
          description={description}
          link={link}
          isSelected={isSelected}
          hemisphere={props.direction}
        />
      </PopoverTrigger>
      {/* XYFlow measures handles relative to its node wrapper. Keeping them out
          of Radix's trigger button ensures both bounds are registered. */}
      <Handle type="source" position={sourcePosition} />
      <Handle type="target" position={targetPosition} />
      {readOnly ? null : (
        <>
          {/* The toolbar never takes focus: pointer users clicked the canvas to
              get here and the same verbs live on shortcuts, so arrow-key map
              navigation keeps working while it is visible. */}
          <PopoverContent
            className={cn(
              "w-auto rounded-[12px] p-1",
              surface === "toolbar" ? "" : "hidden"
            )}
            onOpenAutoFocus={(event) => event.preventDefault()}
            side="top"
            sideOffset={8}
          >
            <NodeContextToolbar canEditFields nodeId={props.id} />
          </PopoverContent>
          {/* The editor is the node opened up, not a form in a popup: it echoes
              the card's surface and 16px corner, one step above the canvas. */}
          <PopoverContent
            className={cn(
              "w-[340px] rounded-[16px] border-line-strong bg-card p-0 text-card-foreground shadow-floating",
              surface === "editor" ? "" : "hidden"
            )}
            side="bottom"
            sideOffset={10}
          >
            <NodeDataInput />
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
};

export {
  BaseNode,
  BaseNodeContent,
  getPopoverSurface,
  NODE_CARD_RADIUS,
  type NodeHemisphere,
};
