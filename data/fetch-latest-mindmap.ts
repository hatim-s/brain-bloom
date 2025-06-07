"use server";

import { Mindmap } from "@/types/Mindmap";
import { createClient } from "@/utils/supabase/client";

export async function fetchLatestMindmap(): Promise<Mindmap | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("mindmaps")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return data[0] ?? null;
}
