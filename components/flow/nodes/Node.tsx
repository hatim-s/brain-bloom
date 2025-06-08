import { Handle, NodeProps, Position } from "@xyflow/react";
import clsx from "clsx";
import { LinkIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Stack } from "@/components/ui/stack";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

export function BaseNodeContent(props: {
  title: string;
  description?: string | undefined;
  link?: string | undefined;
  isSelected: boolean;
  classNames?: {
    container?: string;
    title?: string;
  };
}) {
  const { title, description, link, isSelected, classNames } = props;

  const { container: containerClassName, title: titleClassName } =
    classNames ?? {};

  return (
    <Stack
      className={cn(
        "border border-secondary-foreground rounded-sm py-3 px-5 w-[300px] bg-background",
        {
          "outline outline-2 outline-offset-4 outline-primary !border-primary bg-primary/15":
            isSelected,
        },
        containerClassName
      )}
      direction="column"
    >
      <Typography
        className={clsx("flex-1 font-medium !text-2xl", titleClassName)}
        variant="h4"
      >
        {title}
      </Typography>
      {description ? (
        <Typography
          className="flex-1 text-muted-foreground text-md"
          variant="p"
        >
          {description}
        </Typography>
      ) : null}
      {link ? (
        <Link
          href={link}
          target="_blank"
          className="text-muted-foreground text-xs absolute right-2 top-2"
        >
          <Button variant="ghost" size="icon">
            <LinkIcon className="size-4" />
          </Button>
        </Link>
      ) : null}
    </Stack>
  );
}

export default function BaseNode(
  props: NodeProps & { direction: "left" | "right" }
) {
  const title = props.data.title as string | undefined;
  const description = props.data.description as string | undefined;
  const link = props.data.link as string | undefined;

  const isSelected = props.selected;

  const sourcePosition =
    props.direction === "left" ? Position.Left : Position.Right;
  const targetPosition =
    props.direction === "left" ? Position.Right : Position.Left;

  return (
    <>
      <BaseNodeContent
        title={title ?? "Node"}
        description={description}
        link={link}
        isSelected={isSelected}
      />
      <Handle
        type="source"
        position={sourcePosition}
        className="!size-3 !bg-primary !border-primary"
      />
      <Handle
        type="target"
        position={targetPosition}
        className="!size-3 !bg-primary !border-primary"
      />
    </>
  );
}
