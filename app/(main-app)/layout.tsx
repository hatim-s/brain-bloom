import { fetchQuery } from "convex/nextjs";
import { PropsWithChildren } from "react";

import { ConvexAuthNotice } from "@/components/convex-auth-notice";
import { FloatingSidebar } from "@/components/sidebar";
import { api } from "@/convex/_generated/api";
import { getConvexAuthToken } from "@/lib/convex-server";

export default async function MainAppLayout({ children }: PropsWithChildren) {
  const token = await getConvexAuthToken();
  if (token === null) {
    return (
      <>
        <FloatingSidebar mindmaps={[]} />
        <ConvexAuthNotice />
      </>
    );
  }

  const mindmaps = await fetchQuery(api.mindmaps.listMine, {}, { token });

  return (
    <>
      <FloatingSidebar mindmaps={mindmaps} />
      {children}
    </>
  );
}
