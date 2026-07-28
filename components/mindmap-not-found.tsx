"use client";

import { useRouter } from "next/navigation";

import { Button } from "./ui/button";
import { Stack } from "./ui/stack";
import { Typography } from "./ui/typography";

/** Shown when a mindmap route resolves to nothing the signed-in user can read. */
export function MindmapNotFound() {
  const router = useRouter();

  const handleGoToHome = () => {
    router.push("/new");
  };

  return (
    <Stack
      className="h-full w-full items-center justify-center px-8"
      direction="column"
    >
      <Stack className="max-w-[46ch] items-start gap-y-3" direction="column">
        <Typography className="text-2xl font-semibold" variant="h2">
          This mindmap is not here
        </Typography>
        <Typography className="text-muted-foreground" variant="p">
          It may have been deleted, or the link may point at a map on another
          account. Your other maps are still in the sidebar.
        </Typography>
        <Button className="mt-3" onClick={handleGoToHome}>
          Start a new map
        </Button>
      </Stack>
    </Stack>
  );
}
