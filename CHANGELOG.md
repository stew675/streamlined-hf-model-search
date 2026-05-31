# Changelog — Streamlined HF Model Search

### v260531.02 — Quant Chip Filtering for L2 + L3/L4 Expansion Survival

**Quant chip filtering at L2**: `modelPassesAllFilters()` now checks quant method tags extracted from model IDs (via `getOrphanQuantMethod`) against the active quant filter chips. Same-author fine-tunes whose quant chips are toggled off (e.g., `Qwen/Qwen2.5-7B-AWQ` when AWQ chip is off) are now properly suppressed from L1 counts and L2 expansion — previously quant chips only affected L3/L4 rendering.

**L3/L4 expansion survival**: `_asyncDeepenPass` now passes `skipRender=true` to `refreshAuthorL2Section`, preventing the param deepening pass from calling `renderL2` (which destroyed all L3/L4 DOM via `container.innerHTML` replacement). The sync structural render already renders L2 at the correct filter state; the async pass only deepens unknown params without disrupting expanded L3/L4 sections.

### v260531.01 — Eliminate Deepening Re-queue Bug

Replaced the global `_deepeningParamIds` Set with a `deep_status` field on each L2 model object (0=not attempted, 1=in-flight, 2=complete). This prevents `_asyncDeepenPass` from re-queuing models that already completed deepening when structural renders fire after param resolution crosses filter boundaries — which was causing ~2x API calls for authors with many unresolved params. Also added a `console.assert` guard in the Infer Missing Params path to catch ordering violations, and removed redundant `_deepeningParamIds.delete()` calls from the `tryResolveModelParam` branch.

### v260530.11 — Code Review Fixes

Fixed `_rebuildAllFetchedMap()` not assigning to `_allFetchedById` (critical bug — all `_allFetchedById.get()` calls silently returned undefined). Fixed `_deepeningParamIds` leak on fetch failure in `deepenBatch` so a failed individual fetch no longer permanently prevents re-attempts for that model.

### v260530.10 — O(1) Model Lookup Map

Replaced three `_allFetched.find()` hot paths with a global `_allFetchedById` Map, rebuilt after merge/trim and injection. Also eliminated the O(n²) scan in `markLocalParents` by replacing its local Set + `.find()` with a single Map that serves as both existence check and reference lookup.

### v260530.09 — Initial Release

Single-file, zero-dependency HuggingFace model explorer with 4-level expandable hierarchy (Author → Base Model → Quant Author → Quant). Key capabilities: progressive rendering during fetch and param deepening, queue-based API rate limiting (4 req/s), LRU-cached author/child data, piecewise-linear param slider, hidden-models preview popups with sortable columns, generation-guarded async to prevent stale renders, and batched param resolution with parent inheritance.
