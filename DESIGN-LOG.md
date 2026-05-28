# DESIGN-LOG — Streamlined HF Model Search

Design decisions, changelog entries, and architectural rationale for `streamlined-hf-model-search.html`. Kept separate from source to minimize context churn during LLM-assisted editing.

---

## Code Review Decisions (v260528)

### Accepted
- **Popup visibility guard**: Added `isConnected` check in `schedulePopupShow`; popups hide on tab switch via `visibilitychange`.
- **Config centralization**: Moved popup debounce delay and L4 max samples into CONFIG.
- **`"use strict"`**: Added at top of IIFE — zero cost, catches accidental global leaks.
- **Dev console exposure**: Exposed `_fetchGeneration` as `window.__HF_SEARCH_GEN()` for debugging race conditions.

### Rejected (with rationale)
- **Queue microtask starvation (#1)**: Guard flag (`_dequeueScheduled`) prevents timer stacking; rate limiter enforces 250ms minimum gap between requests. Switching to `queueMicrotask` would block paint opportunities.
- **L2/L3/L4 render deduplication (#4)**: Level-specific differences (badges, popups, expansion/collapse cascade, data flow) require ~10+ callback parameters in a generic helper — reduces readability more than duplication costs.
- **JSDoc annotations**: Adds bulk to a single-file app with existing design notes and self-documenting naming conventions. No runtime benefit.
- **IntersectionObserver lazy loading**: High complexity for marginal UX gain. Click-to-expand model works well; pre-fetching wastes API calls on models users never expand.

---

## Version Changelog

### v260528.05 — Code review: deduplication, dead code removal, consistency fixes
- **Bug fix**: `_trendingAdded` no longer overcounts — `_mergeRequestResult` returns actual models added (not `_fetchSeen` growth, which included filtered-out models).
- **Dead code removed**: `_fetchTotal` (never read after init), `sortKey`/`sortAsc` module-level vars (use `RC.sortKey`/`RC.sortAsc` getters instead), `syncSortState()` function removed.
- **Unified section toggle**: `toggleSection()` helper replaces 15-line expand/collapse blocks in L1/L2/L3 event handlers, handling DOM state, `expandedSections` Set, and optional descendant-prefix cascade-delete on collapse.
- **DOM cache lookup helper**: `_getSectionCached()` replaces repeated cache-hit checks in `refreshAllExpanded`.
- **Parent-stripping consolidation**: `inferParent()` now used by `markLocalParents` and `injectBaseModels` instead of their own inline copies of the loop.
- **Consistency**: `handleSortClick` parameter renamed from `sortKey` to `stateKey`. L2 event delegation uses `this` instead of captured `container`. L2/L3 rows now have `row-even`/`row-odd` zebra classes matching L1.
- **Slider UI dedup**: Skipped (config-object approach reduces readability more than 20-line duplication saves — per DESIGN-LOG.md Code Review Decisions #4 precedent).

### v260528.04 — Render coalescing, error boundary, DOM cache
- **API counter tooltip**: Corrected to state retries are NOT counted, matching actual behavior where `incApiCalls` only fires on success and permanent failure, not retriable errors.
- **tryResolveModelParam render coalescing**: Removed per-model `renderL2` + `refreshAllExpanded` from success path; data is synced to shared state (`_allFetched`, `_paramCache`) and callers batch-render after all resolves complete (`deriveVisibleUnknowns` final `recomputeAndRender`).
- **Slider UI throttling**: Input events now route through rAF-gated `throttledSliderUI` instead of calling `updateDateUI`/`updateParamUI` directly, bounding `getBoundingClientRect()` to once/frame.
- **Error boundary**: `_doFullRender` wrapped in try/catch with recovery status message.
- **DOM ref caching for refreshAllExpanded**: `_domCache` Map stores `{row, detailRow, inner, toggle}` per expansion key; populated on expand, cleared after `renderL1` (innerHTML replacement), used as fast-path in `refreshAllExpanded` with querySelector fallback on stale/miss.

### v260528.03 — API Request Manager optimizations
- Removed redundant polling timeout from in-flight max branch (completions already call `_dequeueNext`).
- Eliminated dead generation check with no async gap.
- Fixed Clear Cache promise leak by rejecting all queued items before truncation.

### v260526.05 — Popup positioning, accessibility, CSS cleanup
- **Popup positioning**: `positionPopupCenter` now runs inside `schedulePopupShow`'s setTimeout callback instead of synchronously on mouseenter, preventing stale `getBoundingClientRect()` values when user scrolls/resizes during the 150ms debounce delay. Scroll/resize listeners hide all visible popups as additional defense against misalignment.
- **Accessibility**: Filter chips, task tags, clear buttons, and popup triggers converted from `<span role="button">` to native `<button type="button>`. Provides better screen reader announcements, default `:focus-visible` outlines, and native Enter/Space handling without JS boilerplate. CSS resets added for button defaults (padding, border, background).
- **fetchJson retry**: Removed `_consecutive429s` reset from network error catch block so that transient network blips during 429 backoff don't clear the amber rate-limit indicator.
- **renderL2Empty guard**: Distinguishes "no data loaded yet" (cache miss, no popupSource) from "no base models match current filters" (data exists but all filtered out).
- **CSS cleanup**: Removed `!important` from `.filter-popup th` sticky position to avoid z-index stacking conflicts with Chromium's sticky header implementation.
- **Param deepening and inference** now fire independently through `fetchJson()` — the queue's INFLIGHT_MAX (5) and rate window (4 req/s) provide sufficient throttling without a separate semaphore layer that compounded delays.

### v260525.31 — Slider tooltips, expansion tracking
- **Slider tooltip alignment**: Date-slider From uses `align-right` (sits left of knob), To uses `align-left` (sits right of knob). Param-slider uses centered (no alignment class). Fixed per-knob alignment prevents tooltip text from overlapping/mashing together when knobs are close — dynamic alignment based on position would flip them inward, merging the text. The fixed offset is intentional; tooltips are hidden entirely on narrow screens (≤600px CSS media query) where overlap risk is highest.
- **Expansion tracking**: `refreshAllExpanded()` uses DOM indices (`data-l1-idx`, `data-l2-idx`) to find detail rows. This is safe in the synchronous render pipeline because indices are always read from the current DOM state after re-render. If rendering is refactored to async partial updates, replace index-based IDs (`d1-${idx}`) with stable identifiers (`data-author`, `data-model`) to avoid stale index → wrong element lookups.

### v260525.30 — Race condition fixes
- **Fix race condition in fetchTasks**: Now takes `gen` as parameter and checks `gen !== _fetchGeneration` at entry, in batch loop, and before `fetchedTasks.add(tag)`. Prevents stale async operations from marking tasks as "fetched" while the caller discards the results, which would leave `fetchedTasks` out of sync with `_allFetched`.
- **Removed dead B/M pattern checks**: Contained B/M pattern matching that could never execute because the `seen.has(candId)` check on the previous line would have already broken the loop if true, and subsequent guards would always be false when reaching that branch.

### v260525.29 — markLocalParents race condition
- Fix race condition in `markLocalParents`: now takes `gen` as a parameter and checks `gen !== _fetchGeneration` before any state modifications. Prevents stale async operations from corrupting `_injectedBaseIds` and `model._injected`.

### v260525.28 — markLocalParents regression
- Fix regression in `markLocalParents`: removal of `const gen = _fetchGeneration` caused `gen === _fetchGeneration` to always be false (gen was undefined), so `_injectedBaseIds` was never populated. Parent models outside date range were incorrectly filtered out even when they had in-range child models.
- Also call `markLocalParents` in `loadAuthorModels`: ensures parent models fetched directly from author API (not in `_allFetched`) are also marked as injected when they have in-range children.

### v260525.27 — resolveParamFromChildren optimization
- Try `extractParamFromId` on each child's ID before making the individual API fetch. Most quant child names contain B/M patterns (e.g., "7B", "13B"), so the individual fetch is now rarely needed. This dramatically reduces API calls during "Infer Missing Params" processing.

### v260525.26 — Inflight dedup, queue-based rate limiter
- **_inflightChildren dedup**: Fallback to fresh fetch when the inflight promise resolves with null results (detached-container / error case) to prevent loading hang.
- **Parent-param backfill from child search results**: Replaced metadata-based extraction (which never worked — search API doesn't return safetensors/gguf) with ID-based B/M pattern matching via `extractParamFromId`.
- **Rate limiter**: Replaced with queue-based API request manager: callers push work items via `fetchJson()`, manager dequeues gated by time-window and in-flight count.
- **Clear Cache**: Removed redundant `_fetchState` flag resets (`fetchedUntagged` etc.) that caused unnecessary API calls; now also clears `_levelState` maps.
- **Popup headers**: "At most N shown" is now dynamic based on actual maxSamples cap.
- **Dead code removed**: Unused `injectionBatches` variable, synchronous generation guards in `markLocalParents` (no-op in single-threaded JS).
- **Accessibility**: Removed `aria-colindex` from colspanned detail-row cells.
- **Proxy indirection** (v260525.21): All callers now access `RenderCoordinator._state`, `_levelState`, and helper methods directly. No indirection remains.

### v260525.21 — Backward-compatible proxies removed
All proxy indirection eliminated; callers access `RenderCoordinator._state`, `_levelState`, and helper methods (`getDetailSort`, `expandedSections`) directly. No indirection remains.

---

## Data Flow

Moved from AGENTS.md to reduce context churn. This describes the end-to-end data pipeline:

1. **Init** (Get Results click): Resolve pipeline tags from From/To bars → fire each request independently through queue-based API manager (`_workQueue`, gated by `INFLIGHT_MAX` ≤5 concurrent + rate window ≤4 req/s) → progressive render after each completion via `_onFetchComplete` → also fetch trending (1000) and untagged models → inject cross-author base models from `cardData.base_model` (also through queue, one at a time with per-completion progress updates) → store in `_allFetched` (trimmed to 16,384 by `lastModified` descending).
2. **Canonical dedup**: `buildCanonicalAuthors()` — when a model name appears under multiple authors, keep only the highest-download variant.
3. **Orphan/nested suppression**: Quants whose parent exists in `_allFetched` but has no explicit `cardData.base_model` are suppressed from L1 (`isOrphanQuant`, name-based inference). Nested quants pointing to another quant rather than a true base are suppressed (`isNestedQuant`).
4. **Render**: `computeAuthorData()` applies date/param sliders, From/To/Special/Quant filters, canonical dedup, and orphan/nested suppression → groups by author → renders L1.
5. **L1 expand** → `loadAuthorModels()`: fetch 1000 author models → filter base models (including same-author fine-tunes) → render L2 → deepen unknown `paramB` in batches of 4 via individual model API.
6. **L2 expand** → `loadChildren()`: search HF API for children by parent ID + name → match on `cardData.base_model` or quant tags. Same-author fine-tunes at L2 only; cross-author at L3 labeled "finetune". Deduplicated via `_inflightChildren`.
7. **L3/L4**: Group children by quant author, apply quant/text filters, render sortable table. `_l2ModelFilter` is applied globally in `modelPassesAllFilters()` before author grouping (affects L1 counts); `_l3AuthorFilter`/`_l4ModelFilter` apply only at their respective render levels.

---

## State Management

Moved from AGENTS.md. Describes non-obvious state variables and their roles:

- `_fetchGeneration` — Monotonically increasing counter incremented by "Get Results" and "Clear Cache". All async functions capture `const gen = _fetchGeneration` at entry and bail if stale — prevents stale renders without AbortController (which can't guard post-fetch side effects like cache writes).
- `_inflightChildren` — `Map<parentId, {promise, results}>` to deduplicate concurrent L3/L4 fetches; results stored directly in the entry to survive LRU cache eviction. Entries set synchronously before the first `await`; concurrent callers read results directly from the entry, bypassing evictable LRU cache.
- `_inflightFetches` — `Map<url, promise>` to deduplicate concurrent `fetchJson` calls before they reach the queue manager.
- `_workQueue` — Array of `{ url, resolve, reject }` work items queued by `fetchJson()`. Drained by `_dequeueNext()` gated by in-flight count and rate window.
- `_inflightCount` — Number of HTTP requests currently executing. Gated at `INFLIGHT_MAX` (5) in `_dequeueNext`.
- `_dequeueScheduled` — Boolean flag preventing duplicate `_scheduleDequeue` calls; reset when queue drains.
- `_fetchSeen`, `_fetchCompleted` — Shared progressive render state initialized by `_initFetchState()` at start of each "Get Results" cycle. Each request's completion handler increments `_fetchCompleted` and triggers re-render via `_onFetchComplete`.
- `_paramCache` — `Map<modelId, paramB>` persists across renders; cleared only by Clear Cache. Bound by unique models encountered (~1.4MB at 16k entries).
- `cache` — In-memory LRU (500 entries) keyed by `"{author}"`, `"{author}_models"`, `"children-{parentId}"`. Uses `cacheSet`/`cacheAccess`. When `children-{parentId}` is evicted, L3 falls back to `s.children` from `l3StateMap` (survives eviction).
- `_apiTimestamps` — Sliding window enforcing ≤4 req/s (1 call per 250ms, no burst). Managed inside `_dequeueNext`, not in `fetchJson`.
- `_injectedBaseIds` — Injections bypass the date slider so recently-updated quants remain reachable via their parent.
- `sliderFrom/sliderTo` — 0..80 (0=Anytime, 1-79=14-day increments, 80=Now).
- `paramSliderFrom/paramSliderTo` — 0..220 (piecewise linear 7-segment mapping).
- `_popupTimers` — `Map<popupEl, timeoutId>` for debounced popup show/hide (150ms show, 200ms hide).

---

## Architecture Decisions

### CSS — Dark theme is fixed
No light/dark toggle is planned. Hardcoded color values are intentional for consistency. CSS variableization would add complexity without benefit for a single-theme app.

### Popup z-index stacking
`.filter-popup` uses `z-index: 1000` with sticky table headers at lower z-indices (100, 90, 80, 70). `isolation` is intentionally NOT used on popups — it breaks the stacking context and causes popups to render behind sticky headers.

### Generation counter vs AbortController
Chosen over AbortController because it guards post-fetch side effects (render, cache write) not just the fetch itself. AbortController would need a parallel mechanism anyway for post-fetch operations like `_allFetched` mutations and LRU cache writes. Always capture `const gen = _fetchGeneration` at the very start of any async function that touches shared state. Check before side-effects. The queue manager checks generation both when dequeuing and post-fetch, rejecting stale items early.

### Queue-based API request manager
Callers push work items via `fetchJson()`; `_dequeueNext` gates on both in-flight count (INFLIGHT_MAX=5) and time window (1 call/250ms = 4 req/s). Failed retries don't increment API counter; only successes and permanent failures do. Retriable errors re-enqueue at tail after backoff delay to compete fairly.

### _allFetched memory management
Trimmed to ALL_FETCHED_MAX (16,384) by `lastModified` descending. Injected base models are pinned during trim so recently-updated quants remain reachable via their parent. `_paramCache` persists across renders and is bounded by unique models encountered (~1.4MB at 16k entries).

### normalizeModel — field stripping
Intentionally drops: sha, siblings, config, library_name, private, and all other API fields. `pipeline_tag` is preserved as-is from the source object (with a safety backfill in `_mergeRequestResult` for edge cases where the API omits it). The HF API returns ~40 fields per model; keeping only 10 saves ~60% memory in `_allFetched` (16k entries × ~5KB vs ~2KB). Add fields back only when a concrete feature requires them.

### Param slider — piecewise-linear mapping
7 segments covering 0..1000B params on a 220-position slider. Dense at low end (0.025B/step up to 1B), coarser above. Chosen over continuous log scale because users care about discrete breakpoints (1B, 7B, 13B, 70B, etc.).

### HTML escaping — object-lookup optimization
Single-pass replacement via lookup table is faster than chained `.replaceAll` calls. Used throughout for XSS-safe interpolation of model IDs and author names.

### B/M param extraction sanity guard
No real model has <1M or >2T params. The regex already has a negative lookbehind guard; this extra check catches anything that passes the regex but is still clearly wrong (e.g., 0.0005B or 5000B).

### Full=true&cardData=true on every fetch
The HF search API never returns safetensors/gguf metadata or cardData without `full=true`. This is the only way to get `base_model` info for hierarchy resolution. The payload is ~5-10KB/model, stored in `_allFetched` (capped at 16k). Memory-vs-API-calls tradeoff: fetching light payloads initially and lazy-loading details would multiply API calls by ~5-10x.

### Two-phase search in loadChildren
First try model name alone (covers quant suffixes), fall back to full parent ID. `strictNameMatch` strips known quant suffixes from candidate IDs before comparing, so Qwen2.5-7B-GGUF matches a search for "Qwen2.5-7B". Same-author fine-tunes are skipped (already shown at L2). Cross-author fine-tunes without explicit base_model are only included if they pass the active task filter and aren't already in `_allFetched`.

### Two-pass base model injection
Pass 1: scan all date-range models, identify parent IDs not yet in `_allFetched`. Marks existing parents as `_injected` so they bypass the date filter. Pass 2: fetch unknown parents independently through API manager queue; progressive re-render via `onBatch()` callback after each completion.

### Popup show/hide debounce
150ms show delay prevents flicker on accidental mouse passes. 200ms hide delay (CONFIG.DEBOUNCE_MS) gives enough time to move from trigger into popup content. Scroll/resize listeners clear all pending timers and hide visible popups as defense against stale positioning.

### Render Pipeline
`requestRender()` (batched via `requestAnimationFrame`) → `_doFullRender()`: computeAuthorData → renderL1 → updateArrows → pruneExpiredExpansions → saveRestoreExpansions (only when `saved` non-null; typically passed by `recomputeAndRender`) → refreshAllExpanded (L2→L3→L4 cascade) → [optional] deriveVisibleUnknowns. Sort state accessed directly via `RC.sortKey`/`RC.sortAsc` getters.

### Same-author fine-tunes
`isBase()` treats same-author fine-tunes as base models so they appear at L2 under their author. `loadChildren()` skips them at L3 and labels cross-author fine-tunes as "finetune". This prevents duplicate display while preserving the hierarchy.

### Parent param inheritance
GGUF/AWQ/GPTQ quants without B/M suffix get `paramB` from parent via post-deepening pass. Stripping removes trailing `-segment` iteratively until a known parent is found (same author's `baseModels` or `_allFetched`). This avoids per-model API calls for quant variants that inherit params from their base.

### Early-exit in param resolution
`resolveParamFromChildren` stops after 3 non-null results agreeing on the current max (up to `DERIVED_BATCH_SIZE`=10). Once confidence is established, further fetches are wasteful.

### Injection via queue
`injectBaseModels` fires each unknown base model fetch independently through `fetchJson()` into `_workQueue`. Concurrency is gated by `INFLIGHT_MAX` and rate window — no artificial batching constant needed. Progress updates fire per-completion in `.finally()`, calling `onBatch()` for incremental re-render.

### Clear Cache + generation guard
Clears all caches and increments `_fetchGeneration` to abort stale async. Unlike `applyFilters`, it collapses all expanded sections (no cached data to restore from). Also resets `_dequeueScheduled` so the queue manager can resume cleanly. Rejects all queued items before truncation to prevent promise leaks.

### Popup source consistency
L2/L4 hidden count and popup hidden count must match exactly. `popupSource` passed to `renderL2` must be the same array that `totalBeforeFilter` was computed from (typically `nonQuantBase`). Any mismatch indicates a bug in how the filtered/unfiltered arrays are derived.

### L2 vs L4 hidden labels
L2 label says "hidden by current filters" and counts models removed by ALL filters (date, param, pipeline, text, etc.), with popup showing all hidden (no sample cap). L4 says "hidden by text filter" and counts only text-filtered models, popup capped at 200 samples. This difference is intentional: L2 filters are many and layered (sliders + chips + text), while L4 only has the text filter.

### Popup ID sanitization
L4 popup IDs replace `/` with `__` in parentId (`l4SafeId`) to produce valid HTML IDs. Trigger and popup must use the same sanitized key to ensure hover events wire up correctly.
