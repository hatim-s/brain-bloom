import { AuroraText } from "@/components/aurora-text";
import { AIMindmapInput } from "@/components/new-ai-mindmap";
import { Particles } from "@/components/particles";
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
    <>
      <main className="w-[50%] mx-auto relative my-20 flex flex-col justify-between">
        <Stack direction="column" className="gap-y-4 w-full mt-32">
          <Box>
            <Typography className="!text-6xl xl:text-nowrap" variant="h1">
              Transform Your <AuroraText>Brain to Branch</AuroraText>
            </Typography>
            <Stack className="flex-wrap gap-x-1" direction="row">
              <Typography
                className="flex flex-row gap-x-1 !text-3xl text-nowrap"
                variant="h3"
              >
                Transform your scattered thoughts into
              </Typography>
              <Typography
                className="text-primary !text-3xl text-nowrap"
                variant="h3"
              >
                organized brilliance
              </Typography>
              <Typography
                className="flex flex-row gap-x-1 !text-3xl text-nowrap"
                variant="h3"
              >
                .
              </Typography>
            </Stack>
          </Box>
          <AIMindmapInput />
        </Stack>
        <Card className="w-full">
          <CardHeader className="flex-row items-center gap-x-2">
            <Typography variant="h3">🎯</Typography>
            <Typography className="!mt-0" variant="h3">
              Pro Tips for Mind-Blowing Maps:
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
      <Box
        className="size-64 bg-green-300 rounded-full blur-3xl absolute -top-32 -right-32"
        style={{
          // @ts-expect-error -- is okay
          "--tw-blur": "blur(100px)",
        }}
      ></Box>
      <Box
        className="size-48 bg-green-300 rounded-full blur-3xl absolute top-[180px] left-[350px] opacity-45"
        style={{
          // @ts-expect-error -- is okay
          "--tw-blur": "blur(75px)",
        }}
      ></Box>
      <Box className="size-32 bg-green-300 rounded-full blur-3xl absolute top-[620px] right-[360px] opacity-60"></Box>
      <Box
        className="size-80 bg-green-300 rounded-full blur-3xl absolute -bottom-40 -left-40 opacity-30"
        style={{
          // @ts-expect-error -- is okay
          "--tw-blur": "blur(100px)",
        }}
      ></Box>
      <Box className="absolute top-0 left-0 bottom-0 right-0 w-full h-full -z-10">
        <Particles />
      </Box>
    </>
  );
}
