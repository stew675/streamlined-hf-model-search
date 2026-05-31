# Changelog — Streamlined HF Model Search

### v260530.11 — Code Review Fixes

Fixed `_rebuildAllFetchedMap()` not assigning to `_allFetchedById` (critical bug — all `_allFetchedById.get()` calls silently returned undefined). Fixed `_deepeningParamIds` leak on fetch failure in `deepenBatch` so a failed individual fetch no longer permanently prevents re-attempts for that model.

### v260530.10 — O(1) Model Lookup Map

Replaced three `_allFetched.find()` hot paths with a global `_allFetchedById` Map, rebuilt after merge/trim and injection. Also eliminated the O(n²) scan in `markLocalParents` by replacing its local Set + `.find()` with a single Map that serves as both existence check and reference lookup.

### v260530.09 — Initial Release

Single-file, zero-dependency HuggingFace model explorer with 4-level expandable hierarchy (Author → Base Model → Quant Author → Quant). Key capabilities: progressive rendering during fetch and param deepening, queue-based API rate limiting (4 req/s), LRU-cached author/child data, piecewise-linear param slider, hidden-models preview popups with sortable columns, generation-guarded async to prevent stale renders, and batched param resolution with parent inheritance.
