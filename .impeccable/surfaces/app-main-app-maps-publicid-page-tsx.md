---
version: 1
slug: "app-main-app-maps-publicid-page-tsx"
primary_target: "app/(main-app)/maps/[publicId]/page.tsx"
related_targets: ["components/flow/Flow.tsx","components/ai-panel/AiPanel.tsx","app/share/[publicId]/page.tsx"]
---

Scope: mindmap canvas surface (app/(main-app)/maps/[publicId]/page.tsx and components/flow, components/ai-panel). Mode: Operate.
Audience: a learner exploring and growing one map.
Task: read the map, grow/revise branches via AI conversation and contextual node actions, rename/save/share; frequency: core daily surface.
Important states: generating (agent working), autosave sync, selected node, AI-touched nodes, empty/new map, share state, errors.
Direction: "The Quiet Study" (DESIGN.md). Edit flow decision (designer call, user-approved): canvas-first contextual AI — selecting a node surfaces inline contextual actions (grow, refine, explain, delete) with a slim inline prompt; the chat panel remains as a recessed, refined side conversation for whole-map dialogue. Old NodeAiEdit flow is replaced.
Constraints: keep xyflow+dagre engine, Convex data model, /api/chat threadId contract, Clerk auth. Memorable moment: the curator-calm glow pulse when the agent touches nodes.
Unresolved: none.
