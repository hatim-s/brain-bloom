import { PropsWithChildren } from "react";

import { FloatingSidebar } from "@/components/sidebar";
import { fetchAllMindmaps } from "@/data/fetch-all-mindmaps";

export default async function MainAppLayout({ children }: PropsWithChildren) {
  // const mindmaps = await fetchAllMindmaps();

  return (
    <>
      <FloatingSidebar mindmaps={[]} />
      {children}
    </>
  );
}
