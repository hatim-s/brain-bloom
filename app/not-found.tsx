import Link from "next/link";

import { Button } from "@/components/ui/button";

/** Global fallback for routes and map identifiers that do not resolve. */
function NotFound() {
  return (
    <main className="flex h-full w-full items-center justify-center px-8">
      <section className="flex max-w-lg flex-col items-start gap-4">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="text-3xl font-semibold">Page not found</h1>
        <p className="text-muted-foreground">
          The page may have moved, or the link may no longer be available.
        </p>
        <Button asChild>
          <Link href="/">Return home</Link>
        </Button>
      </section>
    </main>
  );
}

export { NotFound as default };
