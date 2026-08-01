"use client";

import {
  GitBranchPlus,
  MessageCircleQuestion,
  PenLine,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { useMindmapFlow } from "../../providers/MindmapFlowProvider";
import type { AiEditAction } from "../../providers/types";

/** One toolbar action: the intent it phrases and how it introduces itself. */
type ToolbarAiAction = {
  action: AiEditAction;
  label: string;
  hint: string;
  icon: typeof GitBranchPlus;
};

/**
 * The three scoped intents, ordered by how often a reader reaches for them.
 * Their copy is product language: branches grow, ideas get refined, and the
 * map explains itself.
 */
const AI_ACTIONS: ToolbarAiAction[] = [
  {
    action: "grow",
    label: "Grow",
    hint: "Add ideas under this node",
    icon: GitBranchPlus,
  },
  {
    action: "refine",
    label: "Refine",
    hint: "Sharpen this node's wording",
    icon: Wand2,
  },
  {
    action: "explain",
    label: "Explain",
    hint: "Ask about this node in the conversation",
    icon: MessageCircleQuestion,
  },
];

/**
 * Quiet at rest, moss on approach.
 *
 * Every verb here is an action, so hover and press wear the one action colour
 * over a moss wash — never clay, which stays reserved for the model's own touch.
 */
const TOOLBAR_ACTION =
  "h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-primary/10 hover:text-primary active:bg-primary/15";

/**
 * The floating toolbar a click on a node surfaces.
 *
 * It is the canvas-first door to the model: each AI action opens the inline
 * prompt pre-scoped to this node, and Edit opens the field editor. The toolbar
 * itself never steals focus — pointer users clicked to get here and keyboard
 * users have the same verbs on shortcuts — so arrow-key navigation over the
 * map keeps working while it is visible.
 */
function NodeContextToolbar({
  canEditFields,
  nodeId,
}: {
  /** The root node keeps its title through the map name, not this editor. */
  canEditFields: boolean;
  nodeId: string;
}) {
  const setSelectedNode = useMindmapFlow((state) => state.setSelectedNode);
  const setAiEditNode = useMindmapFlow((state) => state.setAiEditNode);
  const setAiEditAction = useMindmapFlow((state) => state.setAiEditAction);
  const setToolbarNode = useMindmapFlow((state) => state.setToolbarNode);

  /** Swaps the toolbar for the inline prompt phrased around one intent. */
  const openPrompt = (action: AiEditAction) => {
    setAiEditAction(action);
    setToolbarNode(null);
    setSelectedNode(null);
    setAiEditNode(nodeId);
  };

  /** Swaps the toolbar for the field editor. */
  const openEditor = () => {
    setToolbarNode(null);
    setAiEditNode(null);
    setSelectedNode(nodeId);
  };

  return (
    <div
      aria-label="Node actions"
      className="flex items-center gap-0.5"
      role="toolbar"
    >
      {AI_ACTIONS.map(({ action, label, hint, icon: Icon }) => (
        <Tooltip key={action}>
          <TooltipTrigger asChild>
            <Button
              className={TOOLBAR_ACTION}
              onClick={() => openPrompt(action)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Icon aria-hidden="true" className="!size-3.5" />
              {label}
            </Button>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>{hint}</TooltipContent>
        </Tooltip>
      ))}
      {canEditFields ? (
        <>
          {/* A hairline, not a rule: it groups the AI verbs away from Edit. */}
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className={TOOLBAR_ACTION}
                onClick={openEditor}
                size="sm"
                type="button"
                variant="ghost"
              >
                <PenLine aria-hidden="true" className="!size-3.5" />
                Edit
              </Button>
            </TooltipTrigger>
            <TooltipContent sideOffset={6}>
              Edit title, description, and link
            </TooltipContent>
          </Tooltip>
        </>
      ) : null}
    </div>
  );
}

export { AI_ACTIONS, NodeContextToolbar };
