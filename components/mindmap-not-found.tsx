"use client";

import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "./ui/button";
import { Stack } from "./ui/stack";
import { Typography } from "./ui/typography";

export function MindmapNotFound() {
  const router = useRouter();

  const handleGoToHome = () => {
    router.push("/new");
  };

  return (
    <Stack className="w-full items-center justify-center" direction="column">
      <Stack className="bg-red-100 size-12 rounded-xl justify-center items-center mb-4">
        <TriangleAlert className="size-8 text-red-600" />
      </Stack>
      <Typography className="text-primary" variant="h2">
        Mindmap not found
      </Typography>
      <Typography
        className="text-muted-foreground max-w-[400px] items-center text-center"
        variant="p"
      >
        The mindmap you are looking for does not exist, or might have been
        deleted.
      </Typography>
      <Button className="mt-6" onClick={handleGoToHome}>
        Create a new mindmap ✨
      </Button>
    </Stack>
  );
}
