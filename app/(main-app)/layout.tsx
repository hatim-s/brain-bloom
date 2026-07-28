import { fetchQuery } from "convex/nextjs";
import { PropsWithChildren } from "react";

import { FloatingSidebar } from "@/components/sidebar";
import { api } from "@/convex/_generated/api";
import { getConvexAuthToken } from "@/lib/convex-server";

export default async function MainAppLayout({ children }: PropsWithChildren) {
  const token = await getConvexAuthToken();
  const mindmaps = await fetchQuery(api.mindmaps.listMine, {}, { token });

  return (
    <>
      <FloatingSidebar mindmaps={mindmaps} />
      {children}
    </>
  );
}
