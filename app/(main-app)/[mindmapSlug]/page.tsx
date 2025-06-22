import Flow from "@/components/flow/Flow";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Stack } from "@/components/ui/stack";
import { Typography } from "@/components/ui/typography";
import { fetchMindmapById } from "@/data/fetch-mindmap-by-id";

export default async function MindmapPage(props: {
  params: Promise<{ mindmapSlug: string }>;
}) {
  const params = await props.params;
  const { mindmapSlug } = params;

  const mindmap = await fetchMindmapById(mindmapSlug as string);

  if (!mindmap) {
    return <div>Mindmap not found</div>;
  }

  return (
    <SidebarInset>
      <header className="flex h-16 shrink-0 items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Typography className="text-gray-300 font-light text-sm" variant="p">
          {mindmap.name}
        </Typography>
      </header>
      <Stack className="flex-1 p-4 relative">
        <Flow mindmap={mindmap} />
      </Stack>
    </SidebarInset>
  );
}
