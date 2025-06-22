import { createMindmapFromAI } from "@/actions/mindmap";

export default async function NewMindmapPage() {
  const { data: newMindmap, error } = await createMindmapFromAI();
  return <pre>{JSON.stringify(newMindmap, null, 2)}</pre>;
}
