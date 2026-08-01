"use client";

import { PanelLeftClose } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { MindmapDB } from "@/types/Mindmap";

import { Separator } from "../ui/separator";
import { NewMindmapButton } from "./new-mindmap-btn";

/**
 * Live wrapper: reads the route param to highlight the active map. Kept apart
 * from FloatingSidebar so the Suspense fallback can render the same shell
 * without touching request-time data (useParams breaks static prerender).
 */
function ActiveFloatingSidebar({
  loadFailed,
  mindmaps,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  /** True when the server could not read the list; see FloatingSidebar. */
  loadFailed?: boolean;
  mindmaps: MindmapDB[];
}) {
  const params = useParams();
  const publicId = params.publicId as string | undefined;
  return (
    <FloatingSidebar
      activePublicId={publicId}
      loadFailed={loadFailed}
      mindmaps={mindmaps}
      {...props}
    />
  );
}

/** Shared quiet type for the two things the list says when it has no rows. */
const LIST_NOTE_CLASS =
  "px-3 py-2 text-[0.8125rem] leading-relaxed text-muted-foreground";

/**
 * Navigation panel listing every map the signed-in user owns.
 *
 * A sheet floating over the forest ground: the popover surface (the highest
 * tonal step, because this panel genuinely floats), a hairline boundary, the
 * Floating shadow, inset 16px from the viewport edges. Rows are ghost nav
 * items — quiet by default, a sunken tonal step on hover, and the same sunken
 * fill plus full-strength ink when they are the open map, marked by a single
 * moss stem at the left edge. No accent fills: nothing in the navigation
 * competes with the one moss action a view is allowed, and no clay appears
 * anywhere here because nothing in the panel is the model speaking.
 */
function FloatingSidebar({
  mindmaps,
  activePublicId,
  loadFailed = false,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  mindmaps: MindmapDB[];
  /** publicId of the currently open map; undefined in the static fallback. */
  activePublicId?: string;
  /**
   * True when the server failed to read the list, so an empty `mindmaps` means
   * "unknown", not "none". The panel then says so instead of showing the empty
   * state's invitation, which would be a confident claim about an account we
   * never managed to ask about.
   */
  loadFailed?: boolean;
}) {
  const publicId = activePublicId;
  const { toggleSidebar } = useSidebar();

  return (
    <Sidebar
      // The panel truly floats, so it earns the popover step and a shadow; the
      // classes reach past the positioning wrapper to the sheet that carries
      // the surface, where the descendant selector also outranks the sheet's
      // own bg-sidebar regardless of stylesheet order.
      className={[
        // The shared app-shell panel frame: one width, one edge inset, and a
        // top inset that clears the floating chrome band by exactly as much as
        // the Sprig panel on the opposite edge does (panel-geometry.ts).
        "p-[var(--panel-inset)] pt-[var(--panel-top-inset)]",
        "[&_[data-sidebar=sidebar]]:bg-popover",
        "[&_[data-sidebar=sidebar]]:rounded-lg",
        "[&_[data-sidebar=sidebar]]:border",
        "[&_[data-sidebar=sidebar]]:border-border",
        "[&_[data-sidebar=sidebar]]:shadow-floating",
      ].join(" ")}
      variant="floating"
      {...props}
    >
      <SidebarHeader className="gap-0 p-0">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-[0.9375rem] font-semibold leading-none tracking-[-0.01em]">
              Sprig
            </p>
            <p className="font-mono text-[11px] leading-none text-muted-foreground">
              v0.1-alpha
            </p>
          </div>
          <NewMindmapButton />
          {/* The panel closes from inside itself and reopens from its edge tab,
              the same two-part affordance the Sprig panel uses. Neutral on
              hover: the one moss action in this header is New map beside it. */}
          <Button
            aria-label="Close sidebar"
            className="size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
            onClick={toggleSidebar}
            size="icon"
            title="Close sidebar (⌘ /)"
            type="button"
            variant="ghost"
          >
            <PanelLeftClose aria-hidden="true" className="!size-4" />
          </Button>
        </div>
        <Separator className="bg-border" />
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup className="gap-1 p-0">
          <SidebarGroupLabel className="px-3 text-[0.8125rem]">
            Your maps
          </SidebarGroupLabel>
          {mindmaps.length ? (
            <SidebarMenu className="gap-0.5">
              {mindmaps.map((mindmap) => (
                <SidebarMenuItem key={mindmap._id}>
                  <SidebarMenuButton
                    asChild
                    // Sunken fill and ink for the open map, never an accent
                    // fill (DESIGN.md Navigation). The one grove detail in the
                    // panel rides along: a 2px moss stem on the row's left
                    // edge, faded in so the active row reads as growing rather
                    // than as a second button.
                    className={[
                      "relative h-9 px-3 text-muted-foreground",
                      "hover:bg-secondary hover:text-foreground",
                      "data-[active=true]:bg-secondary data-[active=true]:text-foreground",
                      "before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[2px] before:-translate-y-1/2 before:rounded-full before:bg-primary before:opacity-0",
                      "before:transition-opacity before:duration-200 before:ease-settle motion-reduce:before:transition-none",
                      "data-[active=true]:before:opacity-100",
                    ].join(" ")}
                    isActive={mindmap.publicId === publicId}
                  >
                    {/* Client navigation, so switching maps keeps this
                        panel mounted instead of reloading the document. */}
                    <Link
                      href={`/maps/${mindmap.publicId}`}
                      title={mindmap.name}
                    >
                      <span className="truncate text-sm">{mindmap.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          ) : loadFailed ? (
            // Same quiet type as the empty state, never a destructive colour:
            // this is chrome reporting on itself, not the model or the user
            // doing something wrong. Says what happened and the one thing that
            // fixes it, and nothing about maps existing or not.
            <p className={LIST_NOTE_CLASS} role="status">
              Couldn&rsquo;t load your maps — refresh to retry.
            </p>
          ) : (
            <p className={LIST_NOTE_CLASS}>
              No maps yet. The first one you grow shows up here.
            </p>
          )}
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export { ActiveFloatingSidebar, FloatingSidebar };
