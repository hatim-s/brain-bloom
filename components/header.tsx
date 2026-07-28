"use client";

import clsx from "clsx";

import { MindmapDB } from "@/types/Mindmap";

import { Separator } from "./ui/separator";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Typography } from "./ui/typography";

/**
 * The mindmap's title bar.
 *
 * It floats over the canvas rather than sitting on a chrome band, so it stays
 * out of the way of the map. It slides in step with the sidebar on the same
 * curve as the panel itself.
 */
export function Header({ mindmap }: { mindmap: MindmapDB }) {
  const { open } = useSidebar();
  return (
    <header
      className={clsx(
        "absolute top-3 right-0 z-10",
        "items-center flex h-10 shrink-0 gap-2",
        "transition-[left] duration-300 ease-organic motion-reduce:transition-none",
        open ? "left-[332px]" : "left-8" // 300px (sidebar width) + 32px (padding)
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger className="size-8 text-muted-foreground hover:text-foreground [&_svg]:!size-4" />
        </TooltipTrigger>
        <TooltipContent align="start" alignOffset={-10} sideOffset={10}>
          Toggle sidebar
          <kbd className="ml-2 font-mono text-xs text-muted-foreground">
            ⌘ /
          </kbd>
        </TooltipContent>
      </Tooltip>
      <Separator orientation="vertical" className="mx-1 h-4 bg-border" />
      <Typography className="text-sm font-medium" variant="p">
        {mindmap.name}
      </Typography>
    </header>
  );
}
