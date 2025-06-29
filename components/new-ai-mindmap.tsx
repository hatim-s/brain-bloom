"use client";

import { Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createMindmapFromAI } from "@/actions/mindmap";
import { useEventCallback } from "@/hooks/use-event-callback";

import { PromptInput } from "./prompt-input";
import { Button } from "./ui/button";
import { Stack } from "./ui/stack";

export function NewAIMindmap() {
  const [userPrompt, setUserPrompt] = useState("");
  const router = useRouter();

  const [isPending, startTransition] = useTransition();

  const handleSubmit = useEventCallback(async () => {
    startTransition(async () => {
      const aiMindmap = await createMindmapFromAI(userPrompt);
      // console.log({ userPrompt, aiMindmap });

      const mindmapId = aiMindmap.data?.id;
      if (mindmapId) {
        router.push(`/${mindmapId}`);
      }
    });
  });

  return (
    <Stack className="gap-y-3 w-[68%]" direction="column">
      <PromptInput
        placeholders={[
          "How to start a small business?",
          "What coding projects I can make in a weekend?",
          "My weekend project ideas",
          "What are the benifits of mouth breathing?",
        ]}
        onChange={(e) => setUserPrompt(e.target.value)}
      />
      <Button onClick={handleSubmit} disabled={isPending}>
        {isPending ? <Loader className="animate-spin" /> : "Get Started"}
      </Button>
    </Stack>
  );
}
