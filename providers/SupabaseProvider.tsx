"use client";

import { createClient } from "@/utils/supabase/client";
import { createContext, PropsWithChildren, useContext, useState } from "react";

const SupabaseContext = createContext<ReturnType<typeof createClient> | null>(
  null
);

export function useSupabaseClient() {
  const supabase = useContext(SupabaseContext);

  if (!supabase) {
    throw new Error("Supabase client not found");
  }

  return supabase;
}

export default function SupabaseProvider({ children }: PropsWithChildren) {
  const [supabase] = useState(() => createClient());

  return (
    <SupabaseContext.Provider value={supabase}>
      {children}
    </SupabaseContext.Provider>
  );
}
