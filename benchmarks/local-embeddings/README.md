# Phase 0 local embedding benchmark

This directory is an offline evaluation tool, not a production retrieval path.
It compares pinned local embedding candidates and intentionally has no field or
code path that selects, activates, or imports one into the application.

## Safety model

`pnpm benchmark:embeddings` is a dry run. It validates both candidate pins and
the committed fixtures, inspects cache status, and does not import adapter code,
load a model, access the network, or write a report.

An actual evaluation requires a human to provide an adapter and opt in:

```sh
pnpm benchmark:embeddings -- --run --adapter-module ./local-adapter.mjs
```

If a declared offline cache is absent, execution fails before adapter creation.
Downloading is permitted only when `--run` and `--allow-downloads` are both
present. The injected module must named-export
`createEmbeddingAdapterFactory()`. Adapter implementations must respect the
passed `allowDownloads` and `offlineCachePath` options; the harness checks the
artifact checksum before accepting any embedding output. Adapter modules remain
local and are not committed because model runtime selection is still under
evaluation.

Candidate configuration is versioned in `candidates.v1.json`. Each expected
cache digest identifies the complete file or directory at `offlineCachePath`.
For directories, the checksum covers every lexical relative filename and file
content. The repository intentionally does not contain model artifacts or
pre-populated caches. Before a real run, maintainers must independently verify
the upstream revision and update the expected cache-bundle digest in review if
the locally prepared artifact differs. Never weaken checksum validation to make
a cache pass.

## Fixtures and outputs

The committed synthetic corpus contains 30 normalized segments that resemble
PDF headings/tables, DOCX headings/lists, and PPTX titles/bullets. The 32 study
questions cover headings, definitions, slide bullets, paraphrases, and declared
English/Spanish behavior. No fixture contains customer or private data.

Execution produces `comparison.json` and `comparison.md` in the ignored
`results/` directory (override with `--output-dir`). Reports include exact
candidate identity, cache verification, environment, recall@5/10/20 and
category/language splits, cold and warm latency, ingestion throughput, memory,
cache size, and observational budget status. Reports always say
`not-selected`; human review owns the model decision.
