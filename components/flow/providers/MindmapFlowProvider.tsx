import { Edge } from "@xyflow/react";
import { createContext, useCallback, useContext, useState } from "react";
import { StoreApi, useStore } from "zustand";

import { useKey } from "@/hooks/use-key";
import { MindmapDB, MindmapNodeProjection } from "@/types/Mindmap";

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

type MindmapFlowProviderBaseProps = {
  children: React.ReactNode;
  readOnly?: boolean;
  mindmapDB: MindmapDB;
};

type MindmapFlowProviderProps =
  | (MindmapFlowProviderBaseProps & {
      serverNodes: MindmapNodeProjection[];
    })
  | (MindmapFlowProviderBaseProps & {
      initialNodes: BaseFlowNode[];
      initialEdges: Edge[];
    });

/**
 * Provides one isolated mindmap store initialized from the supplied mindmap.
 */
const MindmapFlowProvider = (props: MindmapFlowProviderProps) => {
  const { children, mindmapDB } = props;
  const readOnly = props.readOnly ?? false;

  // A lazy state initializer guarantees one prop-seeded store per provider.
  const [store] = useState(() => {
    if ("serverNodes" in props) {
      return createMindmapStore({
        readOnly,
        mindmapDB,
        serverNodes: props.serverNodes,
      });
    }

    return createMindmapStore({
      readOnly,
      mindmapDB,
      initialNodes: props.initialNodes,
      initialEdges: props.initialEdges,
    });
  });

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
