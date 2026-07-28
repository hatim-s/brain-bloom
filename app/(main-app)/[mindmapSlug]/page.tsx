import { fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";

import { ConvexAuthNotice } from "@/components/convex-auth-notice";
import Flow from "@/components/flow/Flow";
import { Header } from "@/components/header";
import { MindmapNotFound } from "@/components/mindmap-not-found";
import { Stack } from "@/components/ui/stack";
import { api } from "@/convex/_generated/api";
import { getConvexAuthToken } from "@/lib/convex-server";

export default async function MindmapPage(props: {
  params: Promise<{ mindmapSlug: string }>;
}) {
  const params = await props.params;
  const { mindmapSlug } = params;

  const token = await getConvexAuthToken();
  if (token === null) {
    return <ConvexAuthNotice />;
  }

  const result = await fetchQuery(
    api.mindmaps.getByPublicId,
    { publicId: mindmapSlug },
    { token }
  ).catch((error: unknown) => {
    // The query uses this exact public error for absent and unreadable maps.
    if (error instanceof ConvexError && error.data === "Not found") {
      return null;
    }

    throw error;
  });

  if (!result) {
    return <MindmapNotFound />;
  }

  return (
    <>
      <Header mindmap={result.mindmap} />
      <Stack className="flex-1 relative">
        <Flow mindmap={result.mindmap} nodes={result.nodes} />
      </Stack>
    </>
  );
}
