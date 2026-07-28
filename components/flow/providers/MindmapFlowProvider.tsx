import { Edge } from "@xyflow/react";
import { createContext, useCallback, useContext, useState } from "react";
import { StoreApi, useStore } from "zustand";

import { useKey } from "@/hooks/use-key";
import { MindmapDB } from "@/types/Mindmap";

import { BaseFlowNode } from "../types";
import { createMindmapStore, MindmapStore } from "./store";
import { MindmapFlowContext as MindmapFlowContextType } from "./types";

const MindmapFlowContext = createContext<StoreApi<MindmapStore> | null>(null);

/** Reads a selected mindmap state slice from the nearest provider. */
function useMindmapFlow<T>(selector: (state: MindmapFlowContextType) => T): T {
  const store = useContext(MindmapFlowContext);
  if (!store) {
    throw new Error("useMindmapFlow must be used within a MindmapFlowProvider");
  }

  return useStore(store, selector);
}

/** Returns the vanilla store API for subscriptions and atomic sync actions. */
function useMindmapStoreApi(): StoreApi<MindmapStore> {
  const store = useContext(MindmapFlowContext);

  if (!store) {
    throw new Error(
      "useMindmapStoreApi must be used within a MindmapFlowProvider"
    );
  }

  return store;
}

type MindmapFlowProviderProps = {
  children: React.ReactNode;
  mindmapDB: MindmapDB;
  initialNodes: BaseFlowNode[];
  initialEdges: Edge[];
};

/**
 * Provides one isolated mindmap store initialized from the supplied mindmap.
 */
const MindmapFlowProvider = ({
  children,
  mindmapDB,
  initialNodes,
  initialEdges,
}: MindmapFlowProviderProps) => {
  // A lazy state initializer guarantees one prop-seeded store per provider.
  const [store] = useState(() =>
    createMindmapStore({ mindmapDB, initialNodes, initialEdges })
  );

  const debugLogger = useCallback(() => {
    // eslint-disable-next-line no-console -- needed for debug logging
    console.log("mindmap", store.getState());
  }, [store]);

  useKey("d", debugLogger, { isAltKey: true });

  return (
    <MindmapFlowContext.Provider value={store}>
      {children}
    </MindmapFlowContext.Provider>
  );
};

export { MindmapFlowProvider, useMindmapFlow, useMindmapStoreApi };
