import { Stack } from "@/components/ui/stack";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Stack
      className="h-svh w-full items-center justify-center"
      direction="column"
    >
      <Stack
        className="max-w-7xl gap-y-12 w-full items-center justify-center h-full"
        direction="column"
      >
        {children}
      </Stack>
    </Stack>
  );
}
