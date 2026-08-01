"use client";

import { Compass } from "lucide-react";
import { useRouter } from "next/navigation";

import { DotField } from "./dot-field";
import { Button } from "./ui/button";
import { Stack } from "./ui/stack";
import { Typography } from "./ui/typography";

/**
 * Canopy light over the empty canvas region.
 *
 * This state replaces a map, so the region it fills is the one place in the app
 * that would otherwise be flat. One very low-alpha moss field mixed from
 * --primary, matching the auth shell and the 404, keeps the grove ground under
 * the copy without pinning a colour here.
 */
const CANOPY_STYLE = {
  backgroundImage:
    "radial-gradient(110% 74% at 50% 0%, color-mix(in oklab, var(--primary) 7%, transparent) 0%, transparent 66%)",
};

/**
 * Shown when a mindmap route resolves to nothing the signed-in user can read.
 *
 * It sits inside the app shell rather than on a page of its own, so it stays a
 * centred column of type standing on the grove ground the canvas would have
 * filled — canopy light and the canvas dot grid behind it, the same compass mark
 * and unblaming voice as the global 404, one moss action back to the user's real
 * maps, and nothing else competing with the sidebar that still holds them.
 */
function MindmapNotFound() {
  const router = useRouter();

  const handleGoToMaps = () => {
    router.push("/maps");
  };

  return (
    <Stack
      className="relative h-full w-full items-center justify-center overflow-hidden px-6 py-12"
      direction="column"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={CANOPY_STYLE}
      />
      <DotField />
      <Stack
        className="relative max-w-[42ch] items-center gap-y-4 text-center"
        direction="column"
      >
        {/* A sunken well with a hairline, not a coloured badge: the mark orients
            the state without spending the accent on decoration. */}
        <span
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground"
        >
          <Compass className="size-5" />
        </span>
        <Stack className="gap-y-2" direction="column">
          <Typography
            className="text-[1.75rem] font-semibold leading-[1.2] tracking-[-0.02em]"
            variant="h2"
          >
            This map isn&rsquo;t here
          </Typography>
          <Typography
            className="text-[0.9375rem] leading-[1.55] text-muted-foreground"
            variant="p"
          >
            It may have been deleted, or the link may point at a map on another
            account. Your other maps are still in the sidebar.
          </Typography>
        </Stack>
        <Button className="mt-2" onClick={handleGoToMaps}>
          Go to your maps
        </Button>
      </Stack>
    </Stack>
  );
}

export { MindmapNotFound };
