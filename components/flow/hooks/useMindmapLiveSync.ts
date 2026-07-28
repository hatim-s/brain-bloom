"use client";

import { useQuery } from "convex/react";
import { useEffect } from "react";

import { api } from "@/convex/_generated/api";
import type { MindmapNodeProjection } from "@/types/Mindmap";

import { useMindmapFlow } from "../providers/MindmapFlowProvider";

/**
 * Reconciles the owner canvas with Convex's live, versioned node projection.
 */
function useMindmapLiveSync(): void {
  const readOnly = useMindmapFlow((state) => state.readOnly);
  const mindmapId = useMindmapFlow((state) => state.mindmapDB._id);
  const reconcileServerState = useMindmapFlow(
    (state) => state.actions.reconcileServerState
  );
  const serverState = useQuery(
    api.mindmaps.get,
    readOnly ? "skip" : { mindmapId }
  );

  useEffect(() => {
    if (serverState === undefined) {
      return;
    }

    reconcileServerState({
      nodes: serverState.nodes as MindmapNodeProjection[],
      updatedAt: serverState.mindmap.updatedAt,
    });
  }, [reconcileServerState, serverState]);
}

export { useMindmapLiveSync };
