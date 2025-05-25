import { FloatingSidebar } from "@/components/sidebar";
import { fetchAllMindmaps } from "@/data/fetch-all-mindmaps";
import { PropsWithChildren } from "react";

export default async function MainAppLayout({ children }: PropsWithChildren) {
  // const mindmaps = await fetchAllMindmaps();

  return (
    <>
      <FloatingSidebar mindmaps={[]} />
      {children}
    </>
  );
}
