# ADR 0003: Build a first-party knowledge pipeline on Convex primitives

- Status: Proposed
- Date: 2026-08-08
- Decision owners: Sprig maintainers

## Context

Sprig needs grounded answers over material that a user deliberately adds to a
workspace. The pipeline must preserve source provenance, enforce workspace
boundaries, and produce citations that remain meaningful after a source is
updated. It must also leave ingestion and retrieval policy under Sprig's
control rather than delegating those decisions, or user content, to a managed
retrieval service.

This decision defines the Phase 0 architectural boundary. It does not approve
a database schema, parser library, embedding model, vector dimension, or
production rollout. Those choices require the benchmark and review gates below.

## Decision

### Platform boundary and ownership

Use Convex first-party primitives for durable file storage, source and segment
metadata, lexical text-search indexes, and vector indexes. Convex stores and
queries the artifacts; it does not define the ingestion or retrieval policy.

Sprig-owned code is responsible for upload validation, document parsing, site
crawling, normalization, chunking, local embedding, hybrid ranking, and
citation construction. "Local embedding" means embedding execution controlled
by Sprig rather than a managed RAG, crawl, or search product. Do not add a
managed RAG, crawling, or search vendor behind this boundary.

The embedding model and vector dimension remain undecided until the Phase 0
benchmark gate passes. Because vector index dimensions are structural, no
production schema or index may assume either value before that decision.

### Supported inputs

The MVP accepts only:

- uploaded PDF, DOCX, and PPTX files; and
- bounded crawls of static HTML pages on the submitted URL's origin.

The following are explicitly out of scope: OCR, dynamic browser rendering,
authenticated crawling, open-web search, cross-origin crawling, and legacy
Office formats such as DOC, PPT, XLS, and password-protected documents.
Spreadsheet ingestion is also outside this ADR.

File type detection must use validated content signatures and parser results,
not a filename or client-provided MIME type alone. A crawl may fetch only HTTP
or HTTPS HTML documents, follow only same-origin links and redirects, and must
stop at configured page, depth, byte, and duration limits. Unsupported inputs
fail with an actionable error; they must not silently take a lower-fidelity
path.

### Immutable ingestion and atomic activation

Every upload or crawl creates a new immutable source version. Re-ingestion
never mutates the files, normalized segments, embeddings, or provenance of an
existing version. The pipeline stages a version through validation, parsing,
normalization, chunking, embedding, and index readiness before it can serve
queries.

Activation is one atomic metadata transition from the prior active version to
the fully ready version. A failed or cancelled ingestion leaves the prior
version active and queryable. Exactly one version of a logical source is active
within an owner and scope at a time. Superseded versions remain addressable for
persisted citations until the applicable retention policy safely removes them.

### Normalized segments and provenance

Parsers emit a common, ordered segment representation before chunking. Each
stored segment or chunk must retain enough provenance to reconstruct where its
text came from, including:

- immutable source and source-version identifiers;
- owner and authorization scope;
- original filename or canonical URL and content hash;
- media type, parser name/version, ingestion timestamp, and segment ordinal;
- page, slide, heading, paragraph, or canonical DOM locator when available;
- character or element offsets needed to highlight the cited passage; and
- the normalization and chunking versions that produced it.

Normalization may remove presentation noise, but it must not erase document
order or the locator needed for a human to verify a quotation. Chunk identifiers
must be stable within an immutable source version and must not depend on a
query, ranking run, or response.

### Authorized hybrid retrieval

Every retrieval request carries the authenticated owner and workspace or
resource scope. Candidate generation, hydration, ranking, and citation lookup
must all enforce that scope on the server. Post-filtering an unauthorized
global candidate set is not an acceptable authorization boundary, and a client
must never be able to supply an owner identifier that broadens access.

Retrieval combines vector similarity with Convex lexical text search. Sprig
owns the deterministic fusion and any later reranking policy. The implementation
must retain per-channel scores and the final rank for evaluation and diagnosis.
Lexical-only operation must remain possible during rollout and as a rollback
path if an embedding index is unavailable or fails its quality gate.

### Stable citations

An answer persists its citations when the answer is created. Each citation
references the immutable source version and stable segment identifiers, stores
the human-readable locator used at generation time, and records only the
minimal excerpt required to support the claim. Citations are not reconstructed
later from whichever source version happens to be active.

Resolving a citation always performs a current authorization check. Private raw
files, source download URLs, normalized segment bodies, and internal locators
must never become reachable merely because an answer is publicly shared. A
public sharing flow may expose only deliberately published citation metadata
and excerpts; private source access remains denied by default.

### Retrieved content is untrusted evidence

Uploaded and crawled text is untrusted data, including text that resembles a
system prompt, tool request, policy, or instruction. Retrieval may supply that
text only as delimited evidence for answering and citation. It never grants
tool authority, changes system or developer instructions, selects credentials,
expands retrieval scope, or authorizes an external action.

The application must preserve this separation in prompts and tool contracts,
escape or structure retrieved content appropriately, and require authorization
from trusted application state for every tool call. Instructions found inside
a source are ignored unless the user explicitly asks to analyze them as
content.

## Security invariants

These controls are release requirements, not follow-up hardening:

1. Crawl targets and every redirect are parsed and canonicalized before fetch.
   The fetcher permits only the original origin, rejects embedded credentials
   and non-HTTP schemes, and blocks loopback, link-local, private, metadata, and
   otherwise non-public destinations after DNS resolution and re-resolution.
2. Upload and response size, crawl page/depth/time, parser CPU/memory/time, and
   normalized character limits are enforced server-side. Partial limit failures
   do not activate a source version.
3. ZIP-based Office containers are checked for entry count, nesting, encrypted
   entries, expansion ratio, and total expanded bytes before parsing. Macros,
   embedded executables, external relationships, and active content are never
   executed or fetched.
4. HTML is parsed as inert content. Scripts, event handlers, executable URLs,
   frames, forms, and active embeds are discarded; the crawler does not run a
   browser or JavaScript.
5. Parsers run with least privilege and no ambient credentials or unrestricted
   network access. Errors and telemetry must not contain full private document
   bodies.
6. Prompt-injection fixtures are part of evaluation, and tool execution remains
   independently authorized even when retrieved text attempts to override the
   application policy.

## Enforceable cut lines

The first implementation must reject work outside the MVP rather than creating
hidden extension points or best-effort behavior:

- one allowlist for accepted file signatures and one bounded static-HTML crawl
  policy are enforced at ingestion entry points;
- no headless browser, OCR engine, authenticated fetch, open-web discovery, or
  managed retrieval SDK is introduced;
- every query API requires server-derived owner and scope filters;
- only fully staged versions may be activated, and activation occurs through a
  single compare-and-set style transition;
- every answer claiming source support uses persisted, version-qualified
  citations; and
- public answer endpoints cannot call private raw-source or segment-body
  resolvers.

Any proposal to cross one of these lines requires a new ADR or an explicit
amendment to this Proposed decision before implementation.

## Evaluation gate

Before selecting an embedding model or dimension, Phase 0 must run a
reproducible benchmark over representative PDF, DOCX, PPTX, and static HTML
corpora. The corpus must include multi-tenant authorization cases, duplicate
and revised sources, adversarial prompt instructions, malformed files, and
content near each ingestion limit.

The benchmark compares lexical, vector, and fused retrieval using agreed
thresholds for retrieval recall and rank quality, answer citation coverage,
citation locator correctness, cross-scope leakage (which must be zero), ingest
success/failure accuracy, query latency, index/storage size, and embedding
resource cost. It must also demonstrate deterministic citation persistence
across source activation and rollback.

Results, fixtures, model identity and version, dimension, chunking policy,
fusion method, hardware/runtime assumptions, and acceptance thresholds must be
recorded in the implementation pull request or a linked decision artifact.
Until maintainers accept those results, model and dimension remain unset and
vector retrieval cannot become the production default.

## Rollout and rollback

Ship the pipeline behind owner-scoped feature flags. Start with ingestion and
offline evaluation, then shadow retrieval, then a small canary that exposes
citations, and only then expand availability. Audit activation, authorization
denials, parser-limit failures, retrieval mode, source versions, and citation
resolution without logging private content.

Keep the prior active source version and the prior accepted retrieval/index
configuration available during each rollout step. Rollback disables new
ingestion and vector participation, restores the prior configuration or
lexical-only retrieval, and atomically re-points affected logical sources to
their last known-good versions. A rollback must not rewrite responses or their
persisted citations. Incompatible index changes require side-by-side index
versions and backfill verification before traffic moves.

## Consequences

- Sprig retains control of authorization, ranking, provenance, citations, and
  the handling of private content.
- Immutable versions and stable citations increase storage and lifecycle
  complexity, but make answers auditable and rollback safe.
- Hybrid retrieval can serve both exact terminology and semantic matches, at
  the cost of maintaining two retrieval paths and evaluating their fusion.
- Strict parser and crawl bounds exclude useful sources that require OCR,
  JavaScript, authentication, or cross-origin discovery. Those exclusions are
  intentional for the MVP.
- Local embedding avoids a managed RAG dependency but makes model evaluation,
  capacity, upgrades, and index compatibility Sprig responsibilities.
- Public sharing requires a separate sanitized citation representation and
  cannot reuse private source-resolution endpoints.

## Verification before acceptance

An implementation proposal may move this ADR to Accepted only after reviewers
confirm all of the following:

1. The Phase 0 benchmark gate selected and recorded the embedding model and
   vector dimension, or the accepted rollout remains lexical-only.
2. Authorization tests prove isolation for ingestion, candidate retrieval,
   hydration, citation resolution, source activation, and public sharing.
3. Parser and crawler tests cover the supported matrix, every stated limit,
   SSRF and redirect defenses, ZIP bombs, malformed content, and prompt
   injection.
4. Failure-injection tests show that incomplete versions cannot activate and
   that activation and rollback preserve prior readable versions.
5. Retrieval evaluation meets the recorded quality, citation, latency, and
   resource thresholds on held-out fixtures.
6. The dependency and environment diffs contain no managed RAG, crawl, or
   search service and no unreviewed outbound content path.

Schema, dependency, environment, and database changes are deliberately absent
from this ADR-only change and require their own reviewed implementation work.
