import { redirect } from "next/navigation";

import { fetchLatestMindmap } from "@/data/fetch-latest-mindmap";

export default async function Home() {
  const latestMindmap = await fetchLatestMindmap();

  if (!latestMindmap) {
    redirect("/new");
  }

  redirect(`/${latestMindmap?.id}`);
}
