# Changelog — Streamlined HF Model Search

### v260531.05 — Tree Expansion + State Cleanup (Phases 9-13)

**Phase 9 — Dead code removal**: Removed `isOrphanQuant`, `isNestedQuant` functions (zero call sites). Removed stale comments referencing the injection system.

**Phase 10 — TreeNode.expanded flags**: Migrated expansion state from the `expandedSections` Set to TreeNode `expanded` flags. Added `_resolveExpandKey`, `_clearDescendantExpanded`, `_syncExpandedFromSet` helpers. Removed `pruneExpiredExpansions`, `saveRestoreExpansions`. `_asyncDeepenPass` and `refreshAllExpanded` now walk the tree instead of iterating a Set. Trees rebuilt via `rebuildTree()` auto-restore expansions from the persistence Set.

**Phase 11 — Removed `_levelState`**: Replaced `RC._levelState.l2/l3/l4` Maps (storing rendering state per author/model/quant-group) with tree + DOM lookups. Added `_getAuthorL2Data` helper to reconstruct filtered model lists from the tree. Sort handlers in L2/L3/L4 derive indices from DOM data attributes and children from `getTreeChildren()`/`_modelDb`.

**Phase 12 — Removed LRU cache**: Eliminated `cache` Map, `cacheSet`, `cacheAccess` functions. Author model loading now checks the tree for canonical children before fetching. Child model loading uses `getTreeChildren()` instead of cache. Removed `CACHE_MAX` config constant.

**Phase 13 — Removed injection tracking**: Eliminated `_injectedBaseIds` Set, `markLocalParents` function. Simplified `injectBaseModels` (no `_injected` flag tracking) and `_trimAllFetched` (no pinned-model logic). Parent propagation is handled entirely by the tree's `walkFilterL2`.

### v260531.04 — Fix L1 sortRows Crash for Author Data

Added `id: author` to `_authorData` objects built from tree in `_doFullRender`. The `sortRows` function's final tiebreaker `x.id.localeCompare(y.id)` crashed when two L1 rows tied on the primary sort value and the subKey comparison, because `_authorData` entries only had `author` (no `id`). This bug was latent since Phase 4 but surfaced when data distributions produced tied sort values.

### v260531.03 — Placeholder StubRef with Extracted Params + Filter Pipeline Fixes

**Placeholder modelRef**: `buildTreePass2` now calls `extractParamFromId(trueBase)` when creating placeholder L2 nodes for base models not yet in `_modelDb`, producing a stub `modelRef` with `{ id: trueBase, paramB }` instead of `null`. This gives immediate param display for models not returned by search results — the value is later superseded by the real `safetensors` param when `injectBaseModels` discovers the actual entry.

**Parent propagation fix**: `walkFilterL2` no longer reactivates L2 models excluded by the param slider or "Hide Missing Params" chip. It checks `isInParamRange()` for models with known `paramB`, and respects `_hideMissingParamEnabled` for models with null `paramB`.

**Param extraction regex**: `extractParamFromId` now handles MoE patterns (`8x7B` → 7, `8x22B` → 22) and active-param patterns (`A14B` → 14) via a three-tier extraction: strict (no letter/digit before number), MoE (`\d+x(\d+)B`), active (`A(\d+)B`). Replaced the old `RE_B_PARAM`/`RE_M_PARAM` consts with inline patterns. Includes `(?<!\d)` lookbehind to prevent partial-number matching (`22B` → `22`, not `2`).

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
