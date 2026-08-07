# ADR 0001: Use AI Elements through a direct composition boundary

- Status: Accepted
- Date: 2026-08-08
- Decision owners: Sprig maintainers

## Context

Sprig uses AI Elements as the vendor component layer for its chat experience.
Those components are installed as source code under
`components/ai-elements`, which makes them easy to edit but also makes local
changes difficult to distinguish from upstream registry updates. Forking or
wrapping that source would increase upgrade cost and create multiple APIs for
the same primitives.

Sprig still needs product-specific conversation behavior and visual identity.
That work needs a stable home without turning generated components into product
controllers or creating a parallel component library.

## Decision

### Registry source and ownership

The AI Elements registry install is the sole source path for files under
`components/ai-elements`. These files are vendor-owned generated code. Do not
manually edit, copy, fork, or partially reimplement them.

This vendor-owned boundary takes precedence over the repository's docstring
and single named-export statement rules only for registry-generated files under
`components/ai-elements/**`. Those files remain untouched when upstream output
does not satisfy either rule. Both rules continue to apply to every
product-authored file. Any desired change to the upstream source must arrive
through a pinned registry update; do not hand-edit generated files to apply the
repository conventions.

An AI Elements update must be performed through the registry with a pinned
source and tool version. The change must record the registry location, exact
tool version, requested item names, and upstream release, commit, or immutable
digest in its pull request. Never use an unpinned `latest` invocation as update
provenance. Review the complete generated diff before accepting the update;
generated output is not exempt from security, accessibility, API, or visual
review.

### Imports and composition

Product code imports the required primitives directly from
`@/components/ai-elements/<component>` and composes them at the feature call
site. Product components may combine several primitives into a meaningful
Sprig feature, but they must not become pass-through wrappers that merely
rename a primitive, forward the same props, or re-export AI Elements through a
second local API.

### Product state and behavior

Business state and orchestration belong in Sprig-owned hooks or controllers,
such as the chat controller used by `components/ai-panel`. This includes
message lifecycle, persistence, tool and action handling, selection context,
errors, retries, and other product policy. AI Elements receive data and event
handlers through their supported public props; generated components do not
own Sprig business rules.

### Theme customization

Visual customization stays in Sprig's semantic theme tokens and in supported
props or classes supplied at the composition call site. A desired theme change
is not a reason to edit `components/ai-elements`. If the public component API
cannot express an essential customization, first propose that capability
upstream or document a new architectural decision instead of silently forking
the generated source.

## Consequences

- Registry upgrades remain reproducible and generated diffs remain auditable.
- Product behavior stays testable independently of the vendor presentation
  layer.
- Call sites may contain more explicit composition and styling than a design
  built around wrappers, but the actual dependency remains visible.
- Sprig cannot apply arbitrary internal changes to an AI Elements primitive.
  Unsupported needs require an upstream change, a distinct Sprig-owned
  component with genuinely different behavior, or a superseding decision.
- Existing manual divergence discovered under `components/ai-elements` must
  not be treated as precedent. Reconcile it with a pinned registry version in
  a dedicated update.

## Enforcement and verification

Reviewers verify this boundary whenever chat UI or AI Elements change:

1. Any diff under `components/ai-elements` must be an intentional, isolated
   registry update with the pinned provenance described above.
2. Review the generated diff in full and run the checks appropriate to the
   affected primitives, including accessibility and product-level call-site
   tests.
3. New product imports should point directly to
   `@/components/ai-elements/<component>`; reject barrels, re-exports, and
   one-to-one pass-through wrappers.
4. State transitions and product policy must have tests at the owning
   hook/controller boundary rather than being embedded in generated files.
5. Theme changes must resolve to Sprig tokens or supported call-site props and
   classes. Confirm that the generated directory is unchanged for theme-only
   work.

Before merging, inspect `git diff -- components/ai-elements` and the feature
diff separately. A non-update pull request should produce no generated diff.
A registry update should keep product adaptations outside the generated
directory and include the normal typecheck and owned tests.

## Updating or superseding this decision

Update this ADR only to clarify the established boundary without changing its
meaning. A change to ownership, installation path, wrapper policy, state
boundary, or theming strategy requires a new ADR that links to this record and
marks it `Superseded by ADR NNNN`. Registry version changes do not supersede
this decision; they follow its provenance and review requirements.
