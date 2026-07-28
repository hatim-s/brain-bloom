import pick from "lodash/pick";
import { CloudUpload, LoaderCircle } from "lucide-react";
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

/** Saves the current mindmap while exposing the full request as a transition. */
const SaveMindmap = () => {
  const { nodes, edges, mindmapDB } = useMindmapFlow();

  const [isPending, startTransition] = useTransition();

  const handleSaveMindmap = useCallback(() => {
    startTransition(async () => {
      try {
        await updateMindmap({
          ...mindmapDB,
          nodes: nodes.map((node) => pick(node, ["id", "type", "data"])),
          edges: edges.map((edge) => pick(edge, ["id", "source", "target"])),
        });
        toast.success("Mindmap saved successfully");
      } catch {
        toast.error("Failed to save mindmap!");
      }
    });
  }, [nodes, edges, mindmapDB]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-3.5 right-16 z-10 text-muted-foreground hover:text-foreground"
          onClick={handleSaveMindmap}
          disabled={isPending}
        >
          {isPending ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          ) : (
            <CloudUpload />
          )}
          <span className="sr-only">Save mindmap</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent align="center">Save mindmap</TooltipContent>
    </Tooltip>
  );
};

export { SaveMindmap };
