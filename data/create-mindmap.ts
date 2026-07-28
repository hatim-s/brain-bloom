"use server";

import { auth } from "@clerk/nextjs/server";

import { MindmapEdgeDB, MindmapNodeDB } from "@/types/Mindmap";
import { createClient } from "@/utils/supabase/server";

/** Creates a Supabase-backed mindmap owned by the current Clerk user. */
export async function createMindmap(
  name: string = "Untitled",
  nodes?: MindmapNodeDB[],
  edges?: MindmapEdgeDB[]
) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("You must be signed in to create a mindmap.");
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("mindmaps")
    .insert({ name, nodes, edges, owner_user_id: userId })
    .select();

  if (error) {
    throw new Error(error.message);
  }

  return {
    data: data[0],
    error,
  };
}
