import { AIMindmapInput } from "@/components/new-ai-mindmap";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Stack } from "@/components/ui/stack";
import { Typography } from "@/components/ui/typography";

const PROMPT_TIPS = [
  "Ask a question: “How do I run a retrospective?”",
  "Go broad: “Everything about sustainable living”.",
  "Make it yours: “Planning my career change”.",
  "Start from a problem: “Our standups keep overrunning”.",
];

/** Entry point for generating a new mindmap from a written prompt. */
export default async function NewMindmapPage() {
  return (
    <main className="h-full w-full overflow-y-auto">
      <Stack
        className="mx-auto w-full max-w-3xl gap-y-12 px-8 py-24"
        direction="column"
      >
        <Stack className="gap-y-4" direction="column">
          <Typography
            className="text-5xl font-semibold tracking-tight"
            variant="h1"
          >
            Start with one idea.
          </Typography>
          <Typography
            className="max-w-[54ch] text-lg text-muted-foreground"
            variant="p"
          >
            Write what you want to think through. Sprig grows it into a map you
            can edit, extend and reshape.
          </Typography>
        </Stack>

        <AIMindmapInput />

        <Card>
          <CardHeader className="pb-4">
            <Typography className="text-base font-medium" variant="p">
              Prompts that tend to work
            </Typography>
          </CardHeader>
          <CardContent>
            <ul className="grid list-outside list-disc grid-cols-1 gap-x-10 gap-y-2.5 ps-4 text-sm text-muted-foreground marker:text-primary md:grid-cols-2">
              {PROMPT_TIPS.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </Stack>
    </main>
  );
}
