"use server";

import { Mindmap } from "@/types/Mindmap";
import { createClient } from "@/utils/supabase/client";

export async function fetchMindmapById(
  mindmapId: string
): Promise<Mindmap | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("mindmaps")
    .select("*")
    .eq("id", mindmapId);

  if (error) {
    throw new Error(error.message);
  }

  return data[0];
}
