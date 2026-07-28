"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/** Starts a new mindmap. Sits in the sidebar header, next to the wordmark. */
export function NewMindmapButton() {
  const router = useRouter();

  const handleNewMindmap = () => {
    router.push("/new");
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className="shrink-0 !size-8 text-muted-foreground hover:text-foreground [&_svg]:!size-4"
          variant="ghost"
          size="icon"
          onClick={handleNewMindmap}
        >
          <Plus />
          <span className="sr-only">New mindmap</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>New mindmap</TooltipContent>
    </Tooltip>
  );
}
