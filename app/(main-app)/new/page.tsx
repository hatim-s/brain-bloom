import { AuroraText } from "@/components/magicui/aurora-text";
import { AIMindmapInput } from "@/components/new-ai-mindmap";
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
  return (
    <main className="w-[68%] mx-auto px-40 relative">
      <Stack
        direction="column"
        className="gap-y-4 absolute top-[30%] w-[calc(100%-80px)]"
      >
        <Box>
          <Typography variant="h1">
            Transform Your <AuroraText>Brain to Branch</AuroraText>
          </Typography>
          <Typography className="flex flex-row gap-x-1" variant="h3">
            Transform your scattered thoughts into
            <Typography className="text-primary" variant="h3">
              organized brilliance
            </Typography>
            .
          </Typography>
        </Box>
        <AIMindmapInput />
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
