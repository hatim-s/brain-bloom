"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createMindmapFromAI } from "@/actions/mindmap";
import { useEventCallback } from "@/hooks/use-event-callback";

import { PromptInput } from "./prompt-input";
import { Button } from "./ui/button";
import { Stack } from "./ui/stack";

export function AIMindmapInput() {
  const [userPrompt, setUserPrompt] = useState("");
  const router = useRouter();

  const [isPending, startTransition] = useTransition();

  const handleSubmit = useEventCallback(async () => {
    startTransition(async () => {
      const aiMindmap = await createMindmapFromAI(userPrompt);
      // console.log({ userPrompt, aiMindmap });

      const publicId = aiMindmap.data?.publicId;
      if (publicId) {
        router.push(`/${publicId}`);
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
    </Stack>
  );
}
