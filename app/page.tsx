import { fetchLatestMindmap } from "@/data/fetch-latest-mindmap";
import { redirect } from "next/navigation";

export default async function Home() {
  const latestMindmap = await fetchLatestMindmap();

  redirect(`/${latestMindmap?.id}`);
}
