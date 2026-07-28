import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";

import { api } from "@/convex/_generated/api";
import { getConvexAuthToken } from "@/lib/convex-server";

export default async function Home() {
  const token = await getConvexAuthToken();
  const [latestMindmap] = await fetchQuery(
    api.mindmaps.listMine,
    {},
    { token }
  );

  if (!latestMindmap) {
    redirect("/new");
  }

  redirect(`/${latestMindmap.publicId}`);
}
