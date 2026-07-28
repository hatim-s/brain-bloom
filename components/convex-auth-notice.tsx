import { Stack } from "@/components/ui/stack";
import { Typography } from "@/components/ui/typography";

/**
 * Development-visible shell shown when Clerk cannot mint a Convex JWT.
 */
function ConvexAuthNotice() {
  return (
    <section
      aria-labelledby="convex-auth-notice-title"
      className="flex min-h-full flex-1 items-center justify-center p-8"
    >
      <Stack
        className="max-w-xl gap-y-2 rounded-lg border border-destructive bg-card p-6 text-destructive"
        direction="column"
        role="alert"
      >
        <Typography
          className="text-xl font-semibold"
          id="convex-auth-notice-title"
          variant="h2"
        >
          Convex auth is not configured — see docs/ENV.md
        </Typography>
        <Typography className="text-sm" variant="p">
          Configure the Clerk Convex token template, then reload this page.
        </Typography>
      </Stack>
    </section>
  );
}

export { ConvexAuthNotice };
