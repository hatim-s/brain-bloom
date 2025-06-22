"use server";

import { MindmapDB } from "@/types/Mindmap";
import { createClient } from "@/utils/supabase/server";

export async function updateMindmap(mindmap: MindmapDB) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("mindmaps")
    .update(mindmap)
    .eq("id", mindmap.id);

  if (error) {
    throw new Error(error.message);
  }
}
