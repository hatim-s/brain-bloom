import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";

import { ConvexAuthNotice } from "@/components/convex-auth-notice";
import { api } from "@/convex/_generated/api";
import { getConvexAuthToken } from "@/lib/convex-server";

export default async function Home() {
  const token = await getConvexAuthToken();
  if (token === null) {
    return <ConvexAuthNotice />;
  }

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
