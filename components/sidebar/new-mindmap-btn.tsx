"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/**
 * Starts a new map. Sits in the sidebar header, next to the wordmark.
 *
 * Ghost, not moss: the panel is navigation, and the one moss action of any view
 * belongs to the page it frames rather than to the chrome — on /new that action
 * is "Grow the map", and a filled button here would be the second accent
 * DESIGN.md's One Voice Rule forbids. Quiet by default, a sunken tonal step and
 * full-strength ink on hover, like every other row in the panel.
 */
function NewMindmapButton() {
  const router = useRouter();

  const handleNewMindmap = () => {
    router.push("/new");
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className="size-8 shrink-0 text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={handleNewMindmap}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Plus />
          <span className="sr-only">New map</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>New map</TooltipContent>
    </Tooltip>
  );
}

export { NewMindmapButton };
