import clsx from "clsx";

import Flow from "@/components/flow/Flow";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Stack } from "@/components/ui/stack";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Typography } from "@/components/ui/typography";
import { fetchMindmapById } from "@/data/fetch-mindmap-by-id";

export default async function MindmapPage(props: {
  params: Promise<{ mindmapSlug: string }>;
}) {
  const params = await props.params;
  const { mindmapSlug } = params;

  const mindmap = await fetchMindmapById(mindmapSlug as string);

  if (!mindmap) {
    return <div>Mindmap not found</div>;
  }

  return (
    <SidebarInset>
      <header
        className={clsx(
          "absolute top-6 left-6 right-0 z-10",
          "items-center flex h-10 shrink-0 gap-2 px-4"
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger className="-ml-1 size-4 [&_svg]:!size-4" />
          </TooltipTrigger>
          <TooltipContent>⌘ + /</TooltipContent>
        </Tooltip>
        <Separator
          orientation="vertical"
          className="mr-2 h-4 text-gray-300 bg-gray-300"
        />
        <Typography className="text-gray-300 font-light text-sm" variant="p">
          {mindmap.name}
        </Typography>
      </header>
      <Stack className="flex-1 p-4 relative">
        <Flow mindmap={mindmap} />
      </Stack>
    </SidebarInset>
  );
}
