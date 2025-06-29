import Flow from "@/components/flow/Flow";
import { Header } from "@/components/header";
import { Stack } from "@/components/ui/stack";
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
    <>
      <Header mindmap={mindmap} />
      <Stack className="flex-1 relative">
        <Flow mindmap={mindmap} />
      </Stack>
    </>
  );
}
