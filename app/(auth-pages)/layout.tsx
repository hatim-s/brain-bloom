import { DotField } from "@/components/dot-field";
import { Wordmark } from "@/components/wordmark";

/**
 * Frame shared by every unauthenticated route.
 *
 * A single centred column on the page surface: wordmark, then one card held by
 * a hairline. The card is the only raised-feeling thing on the page, and it is
 * raised by a line rather than a shadow, matching the rest of the product.
 */
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="relative h-svh w-full overflow-hidden">
      <DotField />
      <div className="relative flex h-full w-full justify-center overflow-y-auto px-6 py-12">
        <div className="my-auto flex w-full max-w-md flex-col gap-8">
          <div className="flex flex-col items-center gap-1.5">
            <Wordmark />
            <p className="text-center text-sm text-muted-foreground">
              Grow and organize ideas.
            </p>
          </div>
          <div className="rounded-lg border border-line-strong bg-card p-8 text-card-foreground">
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}
