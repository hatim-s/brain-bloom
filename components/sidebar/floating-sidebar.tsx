"use client";

import { useParams } from "next/navigation";
import * as React from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { MindmapDB } from "@/types/Mindmap";

import { Separator } from "../ui/separator";
import { Stack } from "../ui/stack";
import { Typography } from "../ui/typography";
import { TypographyWithTooltip } from "../ui/typography-with-tooltip";
import { NewMindmapButton } from "./new-mindmap-btn";

/**
 * Navigation panel listing every mindmap the signed-in user owns.
 *
 * A floating panel laid over the canvas: card surface, hairline boundary, no
 * elevation. Identity is carried by the wordmark and the moss rail on the
 * active row, not by an icon.
 */
export function FloatingSidebar({
  mindmaps,
  ...props
}: React.ComponentProps<typeof Sidebar> & { mindmaps: MindmapDB[] }) {
  const params = useParams();
  const mindmapSlug = params.mindmapSlug as string;

  return (
    <Sidebar variant="floating" {...props}>
      <SidebarHeader className="gap-0 p-0">
        <Stack className="items-center gap-x-3 px-4 py-3.5" direction="row">
          <Stack className="min-w-0 flex-1 gap-y-1" direction="column">
            <Typography
              className="text-base font-semibold leading-none tracking-tight"
              variant="p"
            >
              Sprig
            </Typography>
            <Typography
              className="font-mono text-[11px] leading-none text-muted-foreground"
              variant="p"
            >
              v0.1-alpha
            </Typography>
          </Stack>
          <NewMindmapButton />
        </Stack>
        <Separator className="bg-border" />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-3 py-3">
          <SidebarGroupLabel className="px-2.5">
            Your mindmaps
          </SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              {mindmaps.length ? (
                <SidebarMenuSub className="mx-0 gap-0.5 border-l-0 px-0">
                  {mindmaps.map((mindmap) => (
                    <SidebarMenuSubItem key={mindmap._id}>
                      <SidebarMenuSubButton
                        asChild
                        isActive={mindmap.publicId === mindmapSlug}
                      >
                        <a href={`/${mindmap.publicId}`}>
                          <TypographyWithTooltip
                            className="text-sm"
                            variant="p"
                          >
                            {mindmap.name}
                          </TypographyWithTooltip>
                        </a>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              ) : (
                <Typography
                  className="px-2.5 py-2 text-sm text-muted-foreground"
                  variant="p"
                >
                  Nothing here yet. Start one and it will show up in this list.
                </Typography>
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
