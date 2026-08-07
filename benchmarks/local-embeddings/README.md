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
pnpm benchmark:embeddings -- --run --adapter-module ./local-adapter.mjs
```

If a declared offline cache is absent, execution fails before adapter creation.
Downloading is permitted only when `--run` and `--allow-downloads` are both
present. Before adapter code is imported, execution confines every cache entry
beneath `.cache/local-embeddings`, rejects absolute paths, parent traversal and
symlink components, and verifies every present artifact checksum. An approved
cache miss is created one directory at a time beneath that same root before its
path is handed to the adapter.

The injected module must named-export `createEmbeddingAdapterFactory()`. Its
adapter must expose the configured adapter/runtime/preprocessing identity,
implement an explicit `load()` phase, and accept `"query"` or `"document"` on
every `embed()` call. Identity drift fails before load. Adapter implementations
must also respect the passed `allowDownloads` and `offlineCachePath` options.
Adapter modules remain local and are not committed because model runtime
selection is still under evaluation.

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

The committed synthetic corpus contains 70 normalized segments, including
relevant passages and distractors resembling PDF headings, tables and
two-column layouts; DOCX headings and lists; and PPTX titles and bullets. It
also contains synthetic duplicate/revised, scope, prompt-injection, malformed
and boundary markers. The 32 study questions cover headings, definitions,
slide bullets, paraphrases, and declared English/Spanish behavior. No fixture
contains customer or private data. Reports record analytic random-expected and
deterministic lexical baselines so recall@20 is interpreted against the full
retrieval pool.

Execution produces `comparison.json` and `comparison.md` beneath the ignored
`results/latest/` directory. `--output-dir <relative-path>` selects only a
subdirectory beneath that dedicated results root; absolute and escaping paths
are rejected. Output directories and destinations may not be symlinks, and
reports are written through exclusive temporary files plus atomic rename.

Reports include exact model, adapter, runtime and preprocessing identity; cache
verification; environment; recall@5/10/20 with complete category/language
sample counts; cold load and cold query timing; repeated, rotated warm-query
passes; ingestion throughput; and absolute before/observed-peak/after RSS. A
below-baseline final RSS marks the memory measurement invalid instead of
clamping it. Reports always say `not-selected`; human review owns the model
decision.
