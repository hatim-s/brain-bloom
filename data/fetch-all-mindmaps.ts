"use server";

import { Mindmap } from "@/types/Mindmap";
import { createClient } from "@/utils/supabase/server";

export async function fetchAllMindmaps(): Promise<Mindmap[] | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("mindmaps")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
}
