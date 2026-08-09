# Phase 0 local embedding benchmark

This directory is an offline evaluation tool, not a production retrieval path.
It compares pinned local embedding candidates and intentionally has no field or
code path that selects, activates, or imports one into the application.

## Safety model

`pnpm benchmark:embeddings` is a dry run. It validates both candidate pins and
the committed fixtures and uses `lstat`-style metadata to report whether each
cache entry exists. It never opens, enumerates, or hashes cache contents and
does not import adapter code, load a model, access the network, or write a
report.

An actual evaluation requires a human to provide an adapter and opt in:

```sh
pnpm benchmark:embeddings -- --run --adapter-module sprig-local-embedding-adapter-1.0.0/adapter.mjs
```

If a declared offline cache is absent, execution fails before adapter creation.
Downloading is permitted only when `--run` and `--allow-downloads` are both
present. Before adapter code is imported, execution confines every cache entry
beneath `.cache/local-embeddings`, rejects absolute paths, parent traversal and
symlink components, and verifies every present artifact checksum. An approved
cache miss is created one directory at a time beneath that same root before its
path is handed to the adapter.

The adapter module and a per-candidate JSON manifest must exist beneath the
dedicated `.cache/local-embedding-adapters` root at the relative paths pinned in
configuration. Both files have reviewed SHA-256 pins and hard byte/file/depth
limits. The harness rejects symlink roots, ancestors and entries, verifies the
module bytes and manifest bytes before execution, parses the verified manifest
buffer, derives adapter/runtime/preprocessing identity from it, then repeats
verification inside the candidate child. The child constructs its VM module
directly from those exact verified bytes instead of reopening the mutable
pathname. A mismatch prevents both module evaluation and factory creation.

Adapter artifacts use the versioned `self-contained-esm-bundle/v1` contract.
Produce exactly one JavaScript ESM `.mjs` bundle that includes the adapter,
runtime wrapper, preprocessing, and tokenizer-like JavaScript helpers, then
SHA-256 digest that final bundle. Do not digest or configure an arbitrary raw
source module that still depends on sibling files, packages, ONNX runtime source
modules, or tokenizer source modules. Model and tokenizer data remain separate
artifacts beneath the verified `offlineCachePath`.

The candidate configuration and its verified manifest must declare the same
bundle contract. For example:

```json
{
  "bundle": {
    "format": "self-contained-esm-bundle/v1",
    "executionBoundary": "node-vm-source-text-module/v1",
    "allowedNodeBuiltins": ["node:crypto"]
  }
}
```

The candidate child evaluates the verified bundle in a fresh
`vm.SourceTextModule` context with a custom linker. The context has no ambient
`process`, `global`, `require`, filesystem, package loader, network, or host
objects. String and WebAssembly code generation are disabled, so direct and
computed `eval`, `Function` constructors, and constructor-chain evaluators
cannot recreate those capabilities. Candidate/options and embedding results
cross the context as JSON text, preventing their constructors from becoming a
host escape. The existing finite child deadline and process-tree cleanup bound
non-responsive bundle execution. The candidate subprocess also starts with
Node's process-wide string-code-generation denial as defense in depth.

The verified bundle may use only static imports of explicitly declared audited
capabilities. Contract v1 supports `node:crypto` through a context-native,
bounded facade that exposes SHA-256 `createHash()` for UTF-8 strings and hex
digests; it does not expose Node's host crypto functions. Relative, absolute,
`file:`, bare-package, other `node:` imports, `require()`, and dynamic `import()`
are rejected before factory creation and again by custom linkage. In particular,
`node:module`, `process.getBuiltinModule()`, and `createRequire()` are
unavailable. A bundle with no capability imports should declare an empty list.
Contract v1 intentionally provides no filesystem capability: model/cache bytes
must not be opened by adapter code until a separately reviewed, confined cache
capability is designed. Maintainers must still review the pinned bundle source
and provenance; resource limits and semantic trust are distinct from module
graph closure.

The verified bundle must export a named `createEmbeddingAdapterFactory()`. Its
adapter implements an explicit `load()` phase and accepts `"query"` or
`"document"` on every `embed()` call. Runtime identity claims must match the
verified manifest. Adapter implementations must also respect the passed
`allowDownloads` and confined `offlineCachePath` options. Adapter bytes remain
local and are not committed because model runtime selection is under review.

Candidate configuration is versioned in `candidates.v1.json`. Each expected
cache digest identifies the complete file or directory at `offlineCachePath`.
For directories, the checksum covers every lexical relative filename and file
content. Hashing rejects symlinks and unsupported entries, streams file bytes,
and enforces the required `maxBytes`, `maxFiles`, and `maxDepth` configuration
before and during traversal. The repository intentionally does not contain
model artifacts or pre-populated caches. Before a real run, maintainers must
independently verify the model, adapter, runtime, preprocessing pins, and cache
bundle digests in review. Never weaken checksum or identity validation to make
a cache pass.

## Fixtures and outputs

The committed synthetic corpus contains 92 normalized segments, including
relevant passages and distractors resembling PDF headings, tables and
two-column layouts; DOCX headings and lists; and PPTX titles and bullets. It
also contains versioned owner/scope metadata plus synthetic cross-owner,
out-of-scope, inactive-revision, prompt-injection, malformed and boundary
scenarios. Six required integrity questions first rank the full corpus to
measure owner, scope, inactive-version, excluded-source, and explicit forbidden
leakage, then apply eligibility for positive retrieval evidence. The 32 study
questions cover headings, definitions,
slide bullets, paraphrases, and declared English/Spanish behavior. No fixture
contains customer or private data. Reports record analytic random-expected and
deterministic lexical baselines so recall@20 is interpreted against the full
retrieval pool.

Execution produces `comparison.json` and `comparison.md` beneath the ignored
`results/latest/` directory. `--output-dir <relative-path>` selects only a
subdirectory beneath that dedicated results root; absolute and escaping paths
are rejected. Output directories and destinations may not be symlinks, and
reports are written through exclusive temporary files plus atomic rename.

Reports include exact model plus verified adapter/module/manifest digests,
runtime and preprocessing identity; cache
verification; environment; recall@5/10/20 with complete category/language
sample counts; cold load and cold query timing; repeated, rotated warm-query
passes; ingestion throughput; integrity leakage/hit rates; and absolute
before/process-high-water/after RSS. Every real candidate runs in a fresh child
process, so earlier candidates cannot contaminate memory results. Each child has
a validated finite deadline and unified process-group cleanup with forced tree
termination. In-process fake runs are explicitly invalid and not
budget-eligible. Cold-load timing
starts before `adapterFactory.create()` and includes explicit load plus eager
query/document preflight. Reports always say `not-selected`; human review owns
the model decision.
