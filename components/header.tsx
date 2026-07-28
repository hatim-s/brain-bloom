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
  const { isLoaded, user } = useUser();
  const { open } = useSidebar();
  const identity = isLoaded
    ? (user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? null)
    : null;
  // A letter, not an avatar image: the header is a hairline-and-type surface,
  // and a remote photo would be the only bitmap on it.
  const initial = identity?.slice(0, 1).toUpperCase();

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
      {/* This shares --theme-switcher-inset with ThemeSwitcher; its own 36px
          width and an 8px gap make the remaining 2.75rem of clearance. */}
      <div className="ml-auto flex min-w-0 items-center gap-2 pr-[calc(var(--theme-switcher-inset)+2.75rem)]">
        {identity ? (
          <>
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
          </>
        ) : (
          <span
            aria-label="Loading account"
            className="flex items-center gap-2"
            role="status"
          >
            <span
              aria-hidden="true"
              className="size-7 shrink-0 rounded-full border border-border bg-muted"
            />
            <span
              aria-hidden="true"
              className="h-3.5 w-20 rounded-sm bg-muted"
            />
          </span>
        )}
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
