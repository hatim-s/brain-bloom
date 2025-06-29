import pick from "lodash/pick";
import { Loader, LucideCloudUpload } from "lucide-react";
import { useCallback, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { updateMindmap } from "@/data/update-mindmap";

import { useMindmapFlow } from "../providers/MindmapFlowProvider";

export function SaveMindmap() {
  const { nodes, edges, mindmapDB } = useMindmapFlow();

  const [isPending, startTransition] = useTransition();

  const handleSaveMindmap = useCallback(() => {
    startTransition(() => {
      updateMindmap({
        ...mindmapDB,
        nodes: nodes.map((node) => pick(node, ["id", "type", "data"])),
        edges: edges.map((edge) => pick(edge, ["id", "source", "target"])),
      })
        .then(() => {
          toast.success("Mindmap saved successfully");
        })
        .catch(() => {
          toast.error("Failed to save mindmap!");
        });
    });
  }, [nodes, edges, mindmapDB]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-8 right-20 z-10"
          onClick={handleSaveMindmap}
          disabled={isPending}
        >
          {isPending ? (
            <Loader className="animate-spin" />
          ) : (
            <LucideCloudUpload />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent align="center">Save Mindmap</TooltipContent>
    </Tooltip>
  );
}
