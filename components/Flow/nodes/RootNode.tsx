import { Button } from "@/components/ui/button";
import { Stack } from "@/components/ui/stack";
import { Typography } from "@/components/ui/typography";
import { Handle, NodeProps, Position } from "@xyflow/react";
import clsx from "clsx";
import { LinkIcon } from "lucide-react";
import Link from "next/link";

export default function RootNode(props: NodeProps) {
  const title = props.data.title as string | undefined;
  const description = props.data.description as string | undefined;
  const link = props.data.link as string | undefined;

  const isSelected = props.selected;

  return (
    <Stack
      className={clsx(
        "border border-secondary-foreground rounded-sm py-3 px-5 w-[300px] bg-background",
        { outline: isSelected }
      )}
      direction="column"
    >
      <Typography className=" flex-1  font-semibold !text-2xl" variant="h4">
        {title ?? "Root Node"}
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
    </Stack>
  );
}
