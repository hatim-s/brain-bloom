import { PropsWithChildren } from "react";

import { FloatingSidebar } from "@/components/sidebar";
import { fetchAllMindmaps } from "@/data/fetch-all-mindmaps";
import { MindmapDB } from "@/types/Mindmap";

const DEFAULT_MINDMAPS = [] as MindmapDB[];

export default async function MainAppLayout({ children }: PropsWithChildren) {
  const mindmaps = await fetchAllMindmaps();

  return (
    <>
      <FloatingSidebar mindmaps={mindmaps ?? DEFAULT_MINDMAPS} />
      {children}
    </>
  );
}
