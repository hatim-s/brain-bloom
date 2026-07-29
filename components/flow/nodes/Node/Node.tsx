import {
  Handle,
  NodeProps,
  Position,
  useUpdateNodeInternals,
} from "@xyflow/react";
import clsx from "clsx";
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
import { NodeAiEdit } from "./NodeAiEdit";
import { NodeDataInput } from "./NodeDataInput";

/**
 * The card that every mindmap node renders into.
 *
 * Flat: a hairline boundary on a card surface, no elevation. Selection is
 * signalled by a 2px moss ring held off the card by a 2px gap in the canvas
 * colour, so the ring reads at any zoom without thickening the card itself.
 *
 * The box model here is load-bearing. `components/flow/layout/init.ts` measures
 * nodes analytically (12px vertical padding, 28px title line, two 24px
 * description lines, 300px wide) to feed dagre. Padding, width and line-heights
 * must not drift or the graph spacing goes wrong.
 */
const BaseNodeContent = (props: {
  title: string;
  description?: string | undefined;
  link?: string | undefined;
  isSelected: boolean;
  classNames?: {
    container?: string;
    title?: string;
  };
}) => {
  const { title, description, link, isSelected, classNames } = props;

  const { container: containerClassName, title: titleClassName } =
    classNames ?? {};

  return (
    <Stack
      className={cn(
        "w-[300px] py-3 px-5 items-start text-left",
        "rounded-lg border border-line-strong bg-card text-card-foreground",
        "transition-[border-color,box-shadow] duration-200 ease-organic motion-reduce:transition-none",
        {
          "border-primary shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--primary)]":
            isSelected,
        },
        containerClassName
      )}
      direction="column"
    >
      <Typography
        className={clsx("flex-1 font-medium !text-xl", titleClassName)}
        variant="h4"
      >
        {title}
      </Typography>
      {description ? (
        <Typography
          className="flex-1 text-base text-muted-foreground line-clamp-2"
          variant="p"
        >
          {description}
        </Typography>
      ) : null}
      {link ? (
        <Link
          href={link}
          target="_blank"
          className="text-xs absolute right-2 top-2"
        >
          <Button
            className="[&_svg]:!size-4 !size-8 text-muted-foreground hover:text-primary"
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
  const isAiEditing = useMindmapFlow((state) => state.aiEditNode);
  const readOnly = useMindmapFlow((state) => state.readOnly);
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    // Radix finalizes the trigger subtree after XYFlow's first node measurement.
    // Re-measure once mounted so the source and target bounds become available.
    updateNodeInternals(props.id);
  }, [props.id, updateNodeInternals]);

  return (
    <Popover
      open={
        !readOnly && (selectedNode === props.id || isAiEditing === props.id)
      }
    >
      <PopoverTrigger
        className={clsx({ "focus-visible:outline-bloom": isSelected })}
      >
        <BaseNodeContent
          title={title ?? "Node"}
          description={description}
          link={link}
          isSelected={isSelected}
        />
      </PopoverTrigger>
      {/* XYFlow measures handles relative to its node wrapper. Keeping them out
          of Radix's trigger button ensures both bounds are registered. */}
      <Handle type="source" position={sourcePosition} />
      <Handle type="target" position={targetPosition} />
      {readOnly ? null : (
        <>
          <PopoverContent
            className={!selectedNode ? "hidden" : ""}
            side="bottom"
            sideOffset={10}
          >
            <NodeDataInput />
          </PopoverContent>
          <PopoverContent
            className={clsx("!p-0 w-[400px]", { hidden: !isAiEditing })}
            side="right"
            sideOffset={20}
          >
            <NodeAiEdit />
          </PopoverContent>
        </>
      )}
    </Popover>
  );
};

export { BaseNode, BaseNodeContent };
