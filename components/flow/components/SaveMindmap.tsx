import { CloudUpload } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useMindmapFlow } from "../providers/MindmapFlowProvider";

/** Retains the legacy save-button position until P6b supplies a status pill. */
const SaveMindmap = () => {
  const syncState = useMindmapFlow((state) => state.syncState);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="absolute top-3.5 right-16 z-10 text-muted-foreground"
      data-sync-state={syncState}
      disabled
      title="autosaves now"
    >
      <CloudUpload />
      <span className="sr-only">Mindmap autosaves now</span>
    </Button>
  );
};

export { SaveMindmap };
