---
name: Sprig
description: Calm, luxurious canvas tool for growing understanding — organic green-clay world at Things 3 / Craft / Notion fidelity.
colors:
  ink-moss: "oklch(0.23 0.022 150)"
  ink-soft: "oklch(0.44 0.024 148)"
  ink-faint: "oklch(0.58 0.02 145)"
  bone: "oklch(0.965 0.01 95)"
  bone-raised: "oklch(0.99 0.006 95)"
  bone-sunken: "oklch(0.938 0.013 92)"
  hairline: "oklch(0.87 0.016 110)"
  hairline-strong: "oklch(0.60 0.026 148)"
  moss: "oklch(0.50 0.115 152)"
  moss-deep: "oklch(0.43 0.115 152)"
  moss-wash: "oklch(0.50 0.115 152 / 0.09)"
  clay: "oklch(0.58 0.115 45)"
  clay-wash: "oklch(0.58 0.115 45 / 0.10)"
  forest: "oklch(0.168 0.018 155)"
  forest-raised: "oklch(0.205 0.02 154)"
  forest-popover: "oklch(0.238 0.021 152)"
  forest-ink: "oklch(0.94 0.012 110)"
  forest-moss: "oklch(0.74 0.125 150)"
  forest-clay: "oklch(0.72 0.105 48)"
  destructive: "oklch(0.55 0.19 27)"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 6vw, 4.25rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 590
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.01em"
  caption:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.01em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  2xl: "64px"
components:
  button-primary:
    backgroundColor: "{colors.moss}"
    textColor: "{colors.bone-raised}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.moss-deep}"
  button-secondary:
    backgroundColor: "{colors.bone-sunken}"
    textColor: "{colors.ink-moss}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  card:
    backgroundColor: "{colors.bone-raised}"
    textColor: "{colors.ink-moss}"
    rounded: "{rounded.lg}"
    padding: "24px"
  input:
    backgroundColor: "{colors.bone-raised}"
    textColor: "{colors.ink-moss}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  node-card:
    backgroundColor: "{colors.bone-raised}"
    textColor: "{colors.ink-moss}"
    rounded: "16px 16px 16px 5px"
    padding: "16px 20px"
---

# Design System: Sprig

## Overview

**Creative North Star: "The Grove"**

Sprig is the polished canvas-tool canon at Things 3 / Craft / Notion / FigJam craft, rendered in the user-pinned **organic green-clay** material world. Dark-first: a deep forest ground where node cards sit like lit clearings; living moss green is the one voice of action; fired clay marks the model's touch. Light sibling: warm bone paper with the same moss and clay. Depth is real and layered — atmosphere, elevation, and grain are welcome where they serve calm richness. The purple/iris colorway is explicitly rejected (user, 2026-07-30) and is anti-reference.

The canvas itself is **free-flowing and nature-inspired**: growth radiates organically from the root rather than filing into columns; edges curve like stems, not wires.

**Key Characteristics:**
- Dark-first (a reader in a lamplit room); warm bone-paper light sibling, not an inversion.
- Restrained but organic: forest neutrals + moss action green + clay AI accent; accents on ≤10% of a screen.
- Real layered depth: soft overhead shadows plus atmospheric elevation (layered tonal fields, subtle grain); never flat, never glassmorphism.
- Type does the luxury: tight-tracked Geist at confident sizes, quiet labels.
- Motion is one damped decelerate curve; growth settles like a branch coming to rest — slow, looping ambience is welcome where the product is demonstrating itself.

## Colors

Forest and bone neutrals carry everything; living moss green is the single voice of action, and fired clay ("glow" in the CSS vars) marks what the AI touched.

### Primary
- **Moss** (light oklch(0.50 0.115 152) / dark oklch(0.74 0.125 150)): primary buttons, links, active states, selection, focus ring. The living green — the one voice of action.
- **Moss Deep** (oklch(0.43 0.115 152)): hover/pressed of Moss in light; dark hovers lift lighter instead.

### Secondary
- **Clay** (light oklch(0.58 0.115 45) / dark oklch(0.72 0.105 48)): AI presence only — the agent's activity indicator, AI-touched node pulse, AI action affordances. Fired-clay warmth; never used for ordinary chrome. (CSS vars keep the historical `--glow` name; the value is clay.)

### Neutral
- **Ink Moss** (oklch(0.23 0.022 150)): primary text in light theme — ink with a breath of green.
- **Ink Soft / Ink Faint**: secondary and tertiary text.
- **Bone** (oklch(0.965 0.01 95)): light page ground — warm bone paper.
- **Bone Raised** (oklch(0.99 0.006 95)): light cards, panels, node cards.
- **Bone Sunken** (oklch(0.938 0.013 92)): wells, secondary buttons, input landing zones.
- **Hairline / Hairline Strong**: decorative dividers vs. actionable-object borders (keep the two-line-token discipline; hairline-strong stays ≥3:1 on its surfaces).
- **Forest family** (ground oklch(0.168 0.018 155), raised 0.205, popover 0.238): the DEFAULT dark world — deep moss-black, never neutral gray, never pure black. Forest Ink (oklch(0.94 0.012 110)) is warm ivory text.

### Named Rules
**The One Voice Rule.** Moss appears on at most ~10% of any screen. If two accents compete, one of them is wrong.
**The Clay Means AI Rule.** Clay marks the model's touch and nothing else. It never styles ordinary hover, badges, or decoration.
**The No Purple Rule.** The rejected iris/violet colorway never returns — no purple hues anywhere (user-pinned, 2026-07-30).

## Typography

**Display Font:** Geist (ui-sans-serif fallback)
**Body Font:** Geist
**Label/Mono Font:** Geist Mono

**Character:** One family, many optical voices — tight negative tracking at display sizes for quiet confidence, relaxed at body sizes for reading. The system-native canon: no decorative faces.

### Hierarchy
- **Display** (600, clamp(2.75rem–4.25rem), 1.05, -0.03em): landing hero, one per page.
- **Headline** (600, 1.75rem, 1.2, -0.02em): page titles ("Your maps").
- **Title** (590, 1.0625rem, 1.35, -0.01em): card titles, panel headers, node root text.
- **Body** (400, 0.9375rem, 1.55): default text; chat, descriptions; ≤70ch.
- **Label** (500, 0.8125rem, 0.01em): buttons, form labels, metadata. Sentence case — never uppercase-tracked labels.
- **Caption** (500, 11px, 1.3): the smallest voice — dense chrome only (panel hints, keyboard hints, status chips). Settled by the first build; never for body content.
- **Mono** (400, 0.8125rem): keyboard shortcuts, technical values only.

### Named Rules
**The Sentence Case Rule.** Everything is sentence case: buttons, labels, nav, empty states. No SHOUTING, no Title Case Chrome.

## Layout

Generous, centered, content-first. Marketing/reading columns max out at 42–46rem; the app shell is full-bleed with floating panels inset 16–24px from viewport edges. Spacing rhythm on a 4px base with named steps (4/8/16/24/40/64); more space above a heading than below it. Density stays airy — a Things-like list breathes at 12–16px vertical padding per row. Mobile: floating panels collapse to slim edge tabs and expand as full-height overlays (the AI panel ships this); canvas chrome collapses to a single toolbar.

## Elevation & Depth

Layered and atmospheric — flatness is a defect (user feedback, 2026-07-30). Tonal layering (forest/bone steps) does the everyday work; shadows are soft, large-radius, low-opacity, and appear where something truly floats (popovers, panels, dragged nodes). On top of that, large surfaces earn **atmosphere**: layered tonal gradients (canopy-light on forest grounds), a whisper of grain, and elevation between page regions. No glassmorphism, no blur-heavy frost.

### Shadow Vocabulary
- **Rest** (`0 1px 2px oklch(0.14 0.02 152 / 0.35)` dark / `… / 0.05` light): cards and node cards at rest.
- **Raised** (`0 2px 8px …/0.45, 0 1px 2px …/0.35` dark): hovered cards, active node.
- **Floating** (`0 12px 32px …/0.55, 0 2px 8px …/0.4` dark): popovers, the node context toolbar, dragged nodes, floating panels.
- Shadow ink is deep forest (oklch(0.14 0.02 152)), not neutral black, so depth stays warm.

### Named Rules
**The Real Light Rule.** All shadows fall down, from one soft overhead light. Accent pulses are rings, not shadows.
**The Never Flat Rule.** Every full-viewport surface carries at least one layer of depth — a tonal field, an elevated sheet, or atmospheric ground — before content lands on it.

## Shapes

Soft continuous rounding: 8/12/16/22 family. Controls at 12px, cards and panels at 16px, hero surfaces and sheets at 22px, pills only for genuine pills (status dots, avatars, toggles). Borders are hairlines, not outlines — 1px, low contrast for decoration, hairline-strong for actionable objects. No sharp corners anywhere; no fully-rounded buttons.

## Components

### Buttons
- **Shape:** 12px radius; height 36px (default), 40px (prominent), 30px (compact).
- **Primary:** Moss fill, bone-raised text, 10px×20px padding; the single obvious next action per view.
- **Hover / Focus:** Moss Deep fill (light) / lifted moss (dark), 150ms; focus = 2px moss ring offset 2px (one treatment product-wide).
- **Secondary:** sunken fill, ink text; **Ghost:** transparent, ink-soft text, sunken on hover.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** raised step over the theme ground (bone-raised / forest-raised).
- **Shadow Strategy:** Rest → Raised on hover (see Elevation).
- **Border:** 1px hairline.
- **Internal Padding:** 24px (16px compact).

### Inputs / Fields
- **Style:** raised fill, 1px hairline-strong border, 12px radius, 10px×14px padding.
- **Focus:** border turns moss + 2px moss ring offset.
- **Error:** destructive border + quiet message below; never red fills.

### Navigation
- App chrome floats: a slim top bar (wordmark, map title, share, account) and floating panels. Nav items are ghost buttons; active state = sunken fill + ink text, not accent fills.

### Node Card (signature)
The mindmap node is a lit clearing on the forest ground: raised sheet, leaf-corner rounding (16px on three corners, 5px on one, mirrored per hemisphere), hairline-strong border, Rest shadow, 20px/590 title at the root scale. Selected: moss border + Raised shadow. AI-touched: a Clay ring that settles back to rest. Root: the grove's heart — raised, moss-warm, largest. **Shipped geometry (the layout engine's contract — `components/flow/layout/nodeSize.ts` enforces it with a test; change both together):** depth-scaled card widths 320/300/264/236px (root→depth 3+), vertical padding 16/14/12/10 per side, title line 30/26/24/21, two-line description block 48/48/42/42. **Layout (`layout/grove.ts`)**: organic radial — root at origin, left/right types as west/east hemispheres each owning a full half-turn (a branch climbs to ~62° off horizontal on ring 1, ~74° on ring 2, above 80° beyond), the only limit being a 177px `POLE_CLEARANCE` corridor kept clear of the vertical axis so two 300px cards can never meet there. Rings are ellipses — semi-widths 440/880/1320 then +440/depth, semi-heights 360/640/920 then +280/depth — because neighbouring rings clear each other by a card width horizontally but only by a card height vertically; rings scale up before nodes may collide. Sibling spans partitioned with shared slack, per-node jitter seeded from an FNV-1a hash of the node id (fully deterministic). Edges are stems (`edges/StemEdge.tsx`): cubic curves with seeded asymmetric bow, ray-vs-box anchored on card boundaries, 1.5px at rest, 2px moss along the root→active trail, clay pulse when AI-touched.

## Do's and Don'ts

### Do:
- **Do** keep one moss-colored primary action per view; everything else is quiet.
- **Do** use tonal steps (raised/sunken) before reaching for a shadow — then give big surfaces atmosphere (layered tonal fields, subtle grain).
- **Do** give every interactive state the shared 150–300ms damped decelerate (`cubic-bezier(0.32, 0.72, 0, 1)`); ambient loops (hero demo, breathing indicators) run slow and seamless.
- **Do** keep the two-line-token discipline: hairline for decoration, hairline-strong for actionable edges.
- **Do** design empty, loading, and error states at the same finish as happy paths.

### Don't:
- **Don't** use any purple/iris/violet hue — the rejected colorway (user-pinned).
- **Don't** ship a flat full-viewport surface; see The Never Flat Rule.
- **Don't** use glassmorphism, neon glows, or neutral-black shadows (shadow ink is deep forest).
- **Don't** uppercase-track labels or ship Title Case chrome.
- **Don't** let AI presence shout: Clay pulses settle; no permanent sparkle badges.
- **Don't** bounce or spring-overshoot; arrival is damped. Slow ambient looping motion is the one sanctioned continuous movement.
