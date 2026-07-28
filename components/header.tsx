"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import clsx from "clsx";

import { MindmapDB } from "@/types/Mindmap";

import { Button } from "./ui/button";
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
  const { signOut } = useClerk();
  const { user } = useUser();
  const { open } = useSidebar();
  const identity =
    user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? "Account";
  // A letter, not an avatar image: the header is a hairline-and-type surface,
  // and a remote photo would be the only bitmap on it.
  const initial = identity.slice(0, 1).toUpperCase();

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
      {/* 68px of right padding clears the floating theme switcher (36px wide,
          24px from the viewport edge) plus one gap. */}
      <div className="ml-auto flex min-w-0 items-center gap-2 pr-[68px]">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line-strong bg-secondary font-mono text-[11px] font-medium text-secondary-foreground"
        >
          {initial}
        </span>
        <span
          className="max-w-[22ch] truncate text-sm text-muted-foreground"
          title={identity}
        >
          {identity}
        </span>
        <Separator orientation="vertical" className="mx-1 h-4 bg-border" />
        <Button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => signOut({ redirectUrl: "/sign-in" })}
          size="sm"
          type="button"
          variant="ghost"
        >
          Sign out
        </Button>
      </div>
    </header>
  );
}
