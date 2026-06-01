# Changelog — Streamlined HF Model Search

### v260601.26 — Perf: Eliminate O(n²) ingestion and repeated string splitting

- Added `_modelTree.byModelName` reverse index (`displayName → L2Node[]`) to
  `recomputeCanonicalForName`, replacing the full scan of all L2 nodes on every
  base model upsert. This was the primary O(n²) bottleneck during ingestion.
- Added `_modelTree.byModelIdLower` reverse index (`lowercase model ID → L2Node`)
  to `ensureL2BaseNode`, replacing the linear case-insensitive fallback scan over
  the entire `byModelId` map.
- `normalizeModel` now precomputes `displayName` and `displayNameLower` on every
  model ref. All render and filter hot paths that previously did
  `m.id.split("/").slice(1).join("/")` per iteration now read the cached fields.
  This eliminates thousands of redundant string split/join/toLowerCase operations
  on every filter change and re-render.
- `walkFilterL2` now writes `_orphanQuantMethods` to both the L2 tree node and the
  underlying model ref. `passesTreeNodeFilters` reads the cached array instead of
  re-running `getOrphanQuantMethod()` (regex + Set spread) per L2 node.

### v260601.25 — Perf: Cache expensive filter computations on tree nodes

- `walkFilterL2` now stores `_orphanQuantMethods` on L2 nodes. `buildL2TableHtml`
  reads this cached array instead of re-running `getOrphanQuantMethod()` per row.
- `walkFilterL4` now stores `_quantFilterString` on L4 nodes. `renderL3` and
  `renderL4` read this cached string instead of re-running `getQuantFilterString()`
  (which involves regex + tag iteration) per displayed child. Major win for models
  with hundreds of quants.
- `renderL3` now uses `l3Node.aggCount` / `l3Node.aggDownloads` when no L3 text
  filter is active, avoiding redundant `reduce` passes over displayed children.
  Only computes from scratch when `RC._state.textFilters.l3Author` is set.

### v260601.24 — Fix: L3 Updated Date Computed from Displayed Children + L2 Fallback

- `renderL3` now computes `maxLastModified` directly from the `displayedL4` array
  (matching how `count` and `totalDownloads` are derived) instead of reading the
  stale `l3Node.aggMaxLastModified` set by `runFilterPipeline`.
- If no displayed children have a `lastModified` date, the L2 parent model's
  `lastModified` is used as a fallback so the "Updated" column never shows "—"
  after dynamic loads.

### v260601.23 — Fix: L2 Expand Now Fetches When Cached Children Are All Filtered Out

- Added `_childrenDeepened` flag to L2 tree nodes, set when `loadChildren` successfully
  completes. Changed `setupL2Events` and `refreshAllExpanded` to check `hasDisplayedChildren`
  instead of `hasAnyChildren`. If an L2 node has cached children but none pass current
  filters, and `_childrenDeepened` is false, the app now fetches fresh children via
  `loadChildren` rather than rendering an empty L3 table.
- Fixes models like `microsoft/Phi-4-mini-instruct` where initial data pulls only found
  1 cached child (which was filtered out by the date slider), causing first-time expand
  to show zero L3 authors even though the dedicated HF search returns 149 children.
- Added `default_model_debug_pull.js` — standalone Node.js debug script that simulates
  the app's initial pulls + child search + filter pipeline for any given model ID.

### v260601.22 — Fix: resolveTrueBase Chains Past Same-Author Fine-Tunes

- `resolveTrueBase` now stops when it encounters a model that `isBase` considers a base
  (same-author derivative or true base), preventing intermediate same-author fine-tunes
  like `gemma-4-26B-A4B-it` from being skipped in favor of their parent base model.
  Previously, quants of `google/gemma-4-26B-A4B-it` were incorrectly placed under
  `google/gemma-4-26B-A4B` because the resolver walked through the `-it` node's
  `cardData.base_model` chain.

### v260601.15 — Review Follow-Ups: Date Stability, A11y, Normalization Safety

- Date slider conversion now uses UTC day-start arithmetic to avoid local DST/day-boundary drift while preserving relative-to-now behavior for the upper bound
- Hidden-models popup triggers now include stronger ARIA wiring (`aria-controls`, `aria-describedby`, `aria-expanded`), and popup containers now expose `role="listbox"` with an explicit label
- Popup show/hide paths now keep trigger `aria-expanded` synchronized, including global hide-on-scroll/resize
- Replaced the `console.assert` deepening ordering check with a runtime `console.warn` so ordering issues still surface in production builds
- Hardened `normalizeModel` with malformed-payload guards and error handling, and updated normalization call sites to skip invalid entries safely

### v260601.14 — Review Follow-Ups: Compatibility + Queue + Docs

- Added an explicit browser compatibility note near param extraction: regex
  lookbehind requires ES2018+ engines (Safari 16.4+, Firefox 78+, Chrome 64+)
- Updated queue rate-window cleanup to use an O(1) head index over
  `_apiTimestamps`, with periodic compaction to prevent unbounded array growth
- Added concise JSDoc blocks for `tryResolveModelParam`, `resolveTrueBase`, and
  `walkFilterL2` to clarify async/stale-guarded and aggregation-heavy paths

### v260601.13 — Tree-Only L3/L4 Rendering Consistency

- `loadChildren` now renders L3 from tree state (`getTreeChildren`) after upserts,
  and no longer uses inflight snapshot lists as a render source
- `resolveTrueBase` now considers incoming model `cardData.base_model` on first
  upsert so cross-author derivatives attach under the correct base lineage
- Added `passesQuantRenderFilters` and wired all L3/L4 render paths to the same
  quant/date/tag predicate used by tree filtering, preventing L3 count vs L4 row drift

### v260531.10 — Tree-Only Storage + Rebuild Removal

- Removed `_modelDb`, `buildTreePass1`, `buildTreePass2`, and `rebuildTree()`
- `_onFetchComplete`, `injectBaseModels`, `loadAuthorModels`, and `loadChildren`
  now rely on incremental tree upserts and render directly (no full rebuild step)
- `_initFetchState` seeds `_fetchSeen` from tree model refs instead of `_modelDb.keys()`
- Removed all remaining legacy comments/references tied to `_modelDb` rebuild flow

### v260531.09 — Incremental Tree Upsert Path

- Added tree mutation primitives: `ensureTreeRoot`, `ensureL1AuthorNode`,
  `ensureL2BaseNode`, `ensureL3Node`, `attachOrUpdateL4Node`,
  `recomputeCanonicalForName`, `upsertModelIntoTree`
- Ingestion writes now route through `upsertModelIntoTree` in
  `_mergeRequestResult`, `injectBaseModels`, `loadAuthorModels`, and `loadChildren`
- Added placeholder-aware L2 promotion and case-insensitive L2 fallback to avoid
  duplicate base nodes on mixed-casing IDs

### v260531.08 — Tree Access Helpers (Prep)

- Added tree-backed access helpers: `getModelNode`, `getModelRef`, `hasModel`,
  `forEachModelRef`, `hasAnyModels`
- Switched low-risk read paths (param inheritance, deepening writeback, child
  dedupe checks, local filter guard) to tree helpers as prep for `_modelDb` removal

### v260531.07 — UX Fixes Round 1: Progressive Render, NaN, Casing, Tiebreaker

- Progressive rendering: `rebuildTree()` inside `_onFetchComplete` so each API
  call updates the tree and triggers a render immediately
- NaN fix: stubRef placeholders now include `downloads: 0, likes: 0, lastModified: ''`;
  `walkFilterL2`/`walkFilterL4` aggregation uses `(ref.downloads || 0)` to prevent
  undefined propagation to NaN
- Case-insensitive author merge: `_modelTree.authorByLower` Map resolves different
  author casings (Qwen/qwen/QWEN) to a single L1 node
- Case-insensitive L2 merge: `buildTreePass2` falls back to case-insensitive
  `byModelId` search, preventing duplicate placeholder L2 nodes when derivative
  `base_model` casing differs from canonical model ID
- Sort tiebreaker: subKey and final `id` tiebreaker now always sort ascending
  regardless of primary sort direction

### v260531.06 — Full _modelDb Migration (Phase 14)

**Phase 14 — Removed `_allFetched` array**: `_modelDb` is now the sole data store. Removed `_allFetched` array, `_allFetchedById` Map, `_trimAllFetched`, `_syncModelDbFromAllFetched`, `_rebuildAllFetchedMap` functions. Removed `CONFIG.ALL_FETCHED_MAX`. `_initFetchState` builds `_fetchSeen` from `_modelDb.keys()`. `_mergeRequestResult` writes only to `_modelDb`. `injectBaseModels` iterates `_modelDb.values()` instead of `_allFetched`. `loadChildren` dedup and param inheritance use `_modelDb.get/has`. `applyLocalFilters` guard checks `_modelDb.size`. `tryResolveModelParam` falls back to `_modelDb` for parent param lookup. Net: -50 lines.

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

### v260601.21 — Code Review Follow-Ups: Tree-Direct Render, Collision Fix, Set Comparison

- `renderL3` and `renderL4` now walk the tree directly via `_modelTree.byModelId.get(parentId)` → L2 → L3 → L4 iteration; removed the intermediate `getTreeChildren()` array allocator entirely
- `renderL3` reads `aggMaxLastModified` from the L3 tree node (computed during `walkFilterL3`) instead of re-scanning L4 `lastModified` values
- `upsertModelIntoTree` now evicts the old L4 node from its L3 parent when a model is promoted from quant to base model, preventing `byModelId` identity collisions where L4 filter bypasses could occur
- `_schedulePostDeepenRender` now compares the actual set of displayed canonical L2 model IDs (pre/post filter), not just the count, to catch swap-in/swap-out scenarios where the total stays the same but membership changes
- `getQuantFilterString`: removed dead `model.q_method` branch (never produced by `normalizeModel`)
- Unified all filter chip ARIA to `role="checkbox"` + `aria-checked` (was mixed `aria-pressed` / `aria-checked`)
- Updated `loadChildren` comment to reflect current behavior (no ingestion-time task filter gate)
- `walkFilterL2` now tracks `_reactivatedByChildren` on L2 nodes when parent propagation activates them; L2 rows show a tooltip on the Updated cell explaining why the model is displayed
- `DESIGN.md` updated to match current `_schedulePostDeepenRender` set-comparison behavior and `loadChildren` documentation

### v260601.20 — Static Filter Fields on Tree Nodes

- Added `totalChildren`, `aggMaxLastModified`, and decomposed `_filterDate` / `_filterQuant` / `_filterTask` / `_filterUntagged` fields to `TreeNode`
- `walkFilterL4` now stores individual filter decisions on each L4 node instead of returning a single boolean
- `walkFilterL3` computes `aggMaxLastModified` (max `lastModified` of displayed L4 children) and `totalChildren`
- `walkFilterL2` computes `totalChildren` as the sum of all L4 descendants under the base model
- `walkFilterL1` computes `totalChildren` as the count of canonical L2 models
- `renderL3`, `refreshAllExpanded` Phase 3, and L4 sort handlers now read `node.display` directly from tree state instead of re-evaluating `passesQuantRenderFilters`
- `loadChildren` no longer drops fetched children at ingestion time based on active task filters; all children enter the tree and visibility is controlled by `runFilterPipeline`
- Removed dead `passesL4Filters` and `passesQuantRenderFilters` functions

### v260530.09 — Initial Release

Single-file, zero-dependency HuggingFace model explorer with 4-level expandable hierarchy (Author → Base Model → Quant Author → Quant). Key capabilities: progressive rendering during fetch and param deepening, queue-based API rate limiting (4 req/s), LRU-cached author/child data, piecewise-linear param slider, hidden-models preview popups with sortable columns, generation-guarded async to prevent stale renders, and batched param resolution with parent inheritance.
