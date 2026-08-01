import { AlertCircle } from "lucide-react";

import { Stack } from "@/components/ui/stack";
import { Typography } from "@/components/ui/typography";

/**
 * Development-visible shell shown when Clerk cannot mint a Convex JWT.
 *
 * Styled as a notice, not an alarm: the destructive token is spent on the card
 * edge and one small mark, while the words stay in the ordinary reading voice.
 * A red fill would shout at a developer who is one config line from fixing it,
 * and would be the loudest surface in the product for a state the user never
 * sees.
 */
function ConvexAuthNotice() {
  return (
    <section
      aria-labelledby="convex-auth-notice-title"
      className="flex min-h-full flex-1 items-center justify-center p-6 sm:p-8"
    >
      <Stack
        className="w-full max-w-xl gap-y-3 rounded-lg border border-destructive bg-card p-6 text-card-foreground shadow-rest"
        direction="column"
        role="alert"
      >
        <Stack className="items-center gap-x-2.5" direction="row">
          <AlertCircle
            aria-hidden="true"
            className="size-4 shrink-0 text-destructive"
          />
          <Typography
            className="text-[1.0625rem] font-semibold leading-[1.35] tracking-[-0.01em]"
            id="convex-auth-notice-title"
            variant="h2"
          >
            Sprig can&rsquo;t reach your data
          </Typography>
        </Stack>
        <Typography
          className="text-[0.9375rem] leading-[1.55] text-muted-foreground"
          variant="p"
        >
          Clerk is not minting a Convex token, so this view has nothing to read.
          Configure the Clerk Convex token template — see{" "}
          <code className="font-mono text-[0.8125rem] text-foreground">
            docs/ENV.md
          </code>{" "}
          — then reload this page.
        </Typography>
      </Stack>
    </section>
  );
}

export { ConvexAuthNotice };
