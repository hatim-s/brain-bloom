"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createMindmapFromAI } from "@/actions/mindmap";
import { useEventCallback } from "@/hooks/use-event-callback";

import { PromptInput } from "./prompt-input";
import { Button } from "./ui/button";
import { Stack } from "./ui/stack";

const GENERATION_ERROR_MESSAGES = {
  "not-configured": "AI is not configured",
  "too-many-nodes": "Sprig generated too many nodes — try a narrower prompt.",
  "generation-failed": "Generation failed — try again.",
} as const;

/** Prompt form that creates and navigates to one atomic AI mindmap. */
function AIMindmapInput() {
  const [userPrompt, setUserPrompt] = useState("");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const router = useRouter();

  const [isPending, startTransition] = useTransition();

  const handleSubmit = useEventCallback(async () => {
    startTransition(async () => {
      setGenerationError(null);

      const aiMindmap = await createMindmapFromAI(userPrompt);

      if (!aiMindmap.ok) {
        setGenerationError(GENERATION_ERROR_MESSAGES[aiMindmap.code]);
        return;
      }

      const publicId = aiMindmap.data.publicId;
      router.push(`/maps/${publicId}`);
      // Refresh the shared server layout so listMine includes the new map.
      router.refresh();
    });
  });

  return (
    <Stack className="w-full gap-y-3" direction="column">
      <PromptInput
        placeholders={[
          "How do I start a small business?",
          "Coding projects I could build in a weekend",
          "What goes into a good onboarding flow?",
          "Ways to cut our cloud bill",
        ]}
        onChange={(e) => setUserPrompt(e.target.value)}
      />
      <Button
        className="self-start"
        onClick={handleSubmit}
        disabled={isPending || !userPrompt}
      >
        {isPending ? (
          <>
            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
            Growing your map
          </>
        ) : (
          "Grow the map"
        )}
      </Button>
      {generationError ? (
        <p className="text-sm font-medium text-destructive" role="alert">
          {generationError}
        </p>
      ) : null}
    </Stack>
  );
}

export { AIMindmapInput };
