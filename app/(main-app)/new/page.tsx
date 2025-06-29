import { NewAIMindmap } from "@/components/new-ai-mindmap";
import { Box } from "@/components/ui/box";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Stack } from "@/components/ui/stack";
import { Typography } from "@/components/ui/typography";

const TIPS = [
  "Be curious: Ask 'How do I...' or 'What are the components of...'.",
  "Go broad: 'Everything about sustainable living' works great.",
  "Get personal: 'Planning my career change' or 'Ideas for my novel'.",
  "Think problems: 'Solving team communication issues'.",
];

export default async function NewMindmapPage() {
  // const { data: newMindmap, error } = await createMindmapFromAI();
  // return <pre>{JSON.stringify(newMindmap, null, 2)}</pre>;
  return (
    <main className="w-full px-20 relative">
      <Stack
        direction="column"
        className="gap-y-4 absolute top-[30%] w-[calc(100%-80px)]"
      >
        <Box>
          <Typography variant="h1">Brain to Branch 🧠 → 🌳</Typography>
          <Typography variant="h3">
            Transform your scattered thoughts into organized brilliance.
          </Typography>
        </Box>
        <NewAIMindmap />
      </Stack>
      <Card className="absolute bottom-20 w-[68%]">
        <CardHeader>
          <Typography variant="h3">
            🎯 Pro Tips for Mind-Blowing Maps:
          </Typography>
        </CardHeader>
        <CardContent>
          <ul>
            {TIPS.map((tip) => (
              <Stack className="gap-x-2" key={tip} direction="row">
                💡
                <li>{tip}</li>
              </Stack>
            ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
