"use client";

import { Network } from "lucide-react";
import { useParams } from "next/navigation";
import * as React from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { MindmapDB } from "@/types/Mindmap";

import { Box } from "../ui/box";
import { Typography } from "../ui/typography";
import { TypographyWithTooltip } from "../ui/typography-with-tooltip";
import { NewMindmapButton } from "./new-mindmap-btn";

// This is sample data.
const getSidenavData = (mindmaps: MindmapDB[], mindmapId: string) => ({
  navMain: [
    {
      title: "Your Mindmaps",
      // url: "#",
      items: mindmaps.map((m) => ({
        title: m.name,
        url: `/${m.id}`,
        id: m.id,
        isActive: m.id === parseInt(mindmapId),
      })),
    },
  ],
});

export function FloatingSidebar({
  mindmaps,
  ...props
}: React.ComponentProps<typeof Sidebar> & { mindmaps: MindmapDB[] }) {
  const params = useParams();
  const mindmapSlug = params.mindmapSlug as string;

  return (
    <Sidebar variant="floating" {...props}>
      <SidebarHeader className="py-4 px-3">
        <SidebarMenu>
          <SidebarMenuItem className="flex flex-row items-center gap-x-3">
            {/* <SidebarMenuButton size="lg" asChild> */}
            <Box className="flex flex-row items-center gap-x-3 flex-1">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Network className="size-4" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-semibold">BrainBloom</span>
                <span className="text-xs">v0.1-alpha</span>
              </div>
            </Box>
            <NewMindmapButton />
            {/* </SidebarMenuButton> */}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu className="gap-2">
            {getSidenavData(mindmaps, mindmapSlug).navMain.map((item) => (
              <SidebarMenuItem
                className="flex flex-col gap-2 ms-1"
                key={item.title}
              >
                <Typography className="text-base font-semibold" variant="p">
                  {item.title}
                </Typography>
                {item.items?.length ? (
                  <SidebarMenuSub className="ml-0 border-l-0 px-1.5">
                    {item.items.map((item) => (
                      <SidebarMenuSubItem key={item.id}>
                        <SidebarMenuSubButton asChild isActive={item.isActive}>
                          <a href={item.url}>
                            <TypographyWithTooltip
                              className="text-sm"
                              variant="p"
                            >
                              {item.title}
                            </TypographyWithTooltip>
                          </a>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                ) : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
