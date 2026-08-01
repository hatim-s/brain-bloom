"use client";

import { PanelLeftOpen } from "lucide-react";

import { PanelEdgeNotch } from "@/components/app-shell/panel-edge-notch";

import { useSidebar } from "../ui/sidebar";

/**
 * The navigation panel's edge tab, and the only way in when it is closed.
 *
 * The mirror image of the Sprig panel's tab on the opposite edge (see
 * `panel-edge-notch.tsx`): the collapsed panel leaves a handle on the viewport
 * edge it hugs rather than delegating its affordance to an icon buried in the
 * header, which is what made the two panels read as unrelated chrome. Closing
 * happens from inside the open panel, exactly as it does for Sprig.
 *
 * Below `md` the panel is an overlay sheet, so the tab tracks the sheet's own
 * open state instead of the desktop preference; `useSidebar` already resolves
 * which of the two `toggleSidebar` drives.
 */
function SidebarNotch() {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar();
  const isPanelVisible = isMobile ? openMobile : open;

  return (
    <PanelEdgeNotch
      isVisible={!isPanelVisible}
      label="Open sidebar"
      onClick={toggleSidebar}
      side="left"
      title="Open sidebar (⌘ /)"
    >
      <PanelLeftOpen aria-hidden="true" className="size-4" />
    </PanelEdgeNotch>
  );
}

export { SidebarNotch };
