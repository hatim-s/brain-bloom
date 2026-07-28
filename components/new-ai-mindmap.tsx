"use client";

import { ConvexError } from "convex/values";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createMindmapFromAI } from "@/actions/mindmap";
import { useEventCallback } from "@/hooks/use-event-callback";

import { PromptInput } from "./prompt-input";
import { Button } from "./ui/button";
import { Stack } from "./ui/stack";

const GENERATION_ERROR_MESSAGES = new Set([
  "AI is not configured",
  "Invalid generated root node",
  "Invalid op: too many nodes",
]);

/** Converts a generation failure into concise, user-visible copy. */
function getGenerationErrorMessage(error: unknown): string {
  if (
    error instanceof ConvexError &&
    typeof error.data === "string" &&
    GENERATION_ERROR_MESSAGES.has(error.data)
  ) {
    return error.data;
  }

  return "Generation failed — try again.";
}

/** Prompt form that creates and navigates to one atomic AI mindmap. */
function AIMindmapInput() {
  const [userPrompt, setUserPrompt] = useState("");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const router = useRouter();

  const [isPending, startTransition] = useTransition();

  const handleSubmit = useEventCallback(async () => {
    startTransition(async () => {
      setGenerationError(null);

      try {
        const aiMindmap = await createMindmapFromAI(userPrompt);
        const publicId = aiMindmap.data.publicId;
        router.push(`/maps/${publicId}`);
        // Refresh the shared server layout so listMine includes the new map.
        router.refresh();
      } catch (error) {
        setGenerationError(getGenerationErrorMessage(error));
      }
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
