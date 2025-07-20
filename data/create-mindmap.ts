"use server";

import { MindmapEdgeDB, MindmapNodeDB } from "@/types/Mindmap";
import { createClient } from "@/utils/supabase/server";

export async function createMindmap(
  name: string = "Untitled",
  nodes?: MindmapNodeDB[],
  edges?: MindmapEdgeDB[]
) {
  const supabase = await createClient();
  const { data: user, error: userError } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }

  const { data, error } = await supabase
    .from("mindmaps")
    .insert({ name, nodes, edges, owner_user_id: user.user.id })
    .select();

  if (error) {
    throw new Error(error.message);
  }

  return {
    data: data[0],
    error,
  };
}
