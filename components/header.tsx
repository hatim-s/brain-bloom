"use client";

import clsx from "clsx";

import { MindmapDB } from "@/types/Mindmap";

import { Separator } from "./ui/separator";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Typography } from "./ui/typography";

export function Header({ mindmap }: { mindmap: MindmapDB }) {
  const { open } = useSidebar();
  return (
    <header
      className={clsx(
        "absolute top-2 right-0 z-10",
        "items-center flex h-10 shrink-0 gap-2",
        "ease-linear duration-200",
        open ? "left-[332px]" : "left-8" // 300px (sidebar width) + 32px (padding)
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger className="size-4 [&_svg]:!size-4" />
        </TooltipTrigger>
        <TooltipContent align="start" alignOffset={-10} sideOffset={10}>
          Toggle Sidebar (⌘ + /)
        </TooltipContent>
      </Tooltip>
      <Separator
        orientation="vertical"
        className="mr-2 h-4 text-gray-700 bg-gray-700 dark:text-gray-300 dark:bg-gray-300"
      />
      <Typography
        className="text-gray-700 font-semibold text-sm dark:text-gray-300"
        variant="p"
      >
        {mindmap.name}
      </Typography>
    </header>
  );
}
