"use client";

import { PencilLine } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { Typography } from "../ui/typography";

export function NewMindmapButton() {
  const router = useRouter();

  const handleNewMindmap = () => {
    router.push("/new");
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className="shrink-0 self-end place-self-end !size-10"
          variant="ghost"
          size="icon"
          onClick={handleNewMindmap}
        >
          <PencilLine className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <Typography variant="p">New Mindmap</Typography>
      </TooltipContent>
    </Tooltip>
  );
}
