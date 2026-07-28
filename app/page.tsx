import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";

/** Resolves the request-specific landing action without blocking the shell. */
async function LandingAuthCta() {
  const { userId } = await auth();

  return (
    <Button asChild>
      <Link href={userId ? "/maps" : "/sign-in"}>
        {userId ? "Open your maps" : "Sign in"}
      </Link>
    </Button>
  );
}

/** Public, statically prerenderable introduction to Sprig. */
function Home() {
  return (
    <main className="h-full w-full overflow-y-auto">
      <section className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-start justify-center gap-6 px-8 py-20">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
            Sprig
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">
            Grow ideas into clear mindmaps.
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Build, connect, and revisit the ideas you want to understand.
          </p>
        </div>
        <Suspense
          fallback={
            <Button disabled type="button">
              Checking account…
            </Button>
          }
        >
          <LandingAuthCta />
        </Suspense>
      </section>
    </main>
  );
}

export { Home as default };
