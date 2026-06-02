# DESIGN — Streamlined HF Model Search

Architecture decisions, data flow, state management, and configuration reference for `streamlined-hf-model-search.html`. Kept separate from source to minimize context churn during LLM-assisted editing.

---

## Overview

Single-file, zero-dependency HTML/JS/CSS application that explores HuggingFace base models through a 4-level expandable hierarchy: **Author** (L1) → **Base Model** (L2) → **Quant Author** (L3) → **Quant** (L4). Approximately 3,200 lines of vanilla JavaScript with inline CSS. No external libraries or frameworks.

`APP_VERSION` follows the format `DATE.DAILY_COUNT` (e.g., `260530.09` = May 30, 2026, 9th change that day). This counter increments with each meaningful code change and persists as a convention going forward.

---

## Data Flow

1. **Init** (Get Results click): Resolve pipeline tags from From/To bars → fire each request independently through queue-based API manager (`_workQueue`, gated by `INFLIGHT_MAX` ≤5 concurrent + rate window ≤4 req/s) → each completion normalizes models and upserts directly into `_modelTree` via `upsertModelIntoTree` → progressive render via `_onFetchComplete`.
2. **Canonical dedup**: `recomputeCanonicalForName()` runs during upsert for L2 base models. For duplicate model names across authors, only the highest-download author copy remains canonical.
3. **Hierarchy resolution**: `resolveTrueBase()` follows `cardData.base_model` links already present in tree refs, but **stops at same-author fine-tunes** (models where `isBase()` is true) because those are treated as L2 parents in the tree. This prevents quants of `gemma-4-26B-A4B-it` from being incorrectly placed under `gemma-4-26B-A4B`. Missing parents create non-canonical hidden placeholders.
4. **Render**: `runFilterPipeline()` applies date/param/chip/text filters and parent propagation directly on tree nodes (`display`, `agg*`) → `RenderCoordinator` builds L1 rows from visible L1 nodes.
5. **L1 expand** → `loadAuthorModels()`: fetch 1000 author models → filter base models (including same-author fine-tunes) → render L2 → deepen unknown `paramB` in batches of 4 via individual model API.
6. **L2 expand** → `loadChildren()`: search HF API for children by parent ID + name → match on `cardData.base_model` or quant tags. Same-author fine-tunes at L2 only; cross-author at L3 labeled "finetune". Deduplicated via `_inflightChildren`.
7. **L3/L4**: Group children by quant author, apply quant/text filters, render sortable table. L2 text filter participates in tree-level filtering (`passesTreeNodeFilters` inside `runFilterPipeline`) and affects L1 counts; L3/L4 text filters apply at their respective render levels.

---

## State Management

- `_fetchGeneration` — Monotonically increasing counter incremented by "Get Results" and "Clear Cache". All async functions capture `const gen = _fetchGeneration` at entry and bail if stale via `isStale(gen)` — prevents stale renders without AbortController (which can't guard post-fetch side effects like cache writes).
- `_inflightChildren` — `Map<parentId, {promise, results}>` to deduplicate concurrent L3/L4 fetches; results stored directly in the entry to survive LRU cache eviction. Entries set synchronously before the first `await`; concurrent callers read results directly from the entry, bypassing evictable LRU cache.
- `_childrenDeepened` — Flag on L2 tree nodes set by `loadChildren` after a successful fetch. Used by `setupL2Events` and `refreshAllExpanded` to distinguish "never loaded" from "loaded but all children filtered out", preventing empty L3 tables when cached children fail current filters while undiscovered children on HF might pass.
- `_inflightFetches` — `Map<url, promise>` to deduplicate concurrent `fetchJson` calls before they reach the queue manager.
- `_workQueue` — Array of `{ url, resolve, reject }` work items queued by `fetchJson()`. Drained by `_dequeueNext()` gated by in-flight count and rate window.
- `_inflightCount` — Number of HTTP requests currently executing. Gated at `INFLIGHT_MAX` (5) in `_dequeueNext`.
- `_dequeueScheduled` — Boolean flag preventing duplicate `_scheduleDequeue` calls; reset when queue drains.
- `_fetchSeen`, `_fetchCompleted` — Shared progressive render state initialized by `_initFetchState()` at start of each "Get Results" cycle. Each request's completion handler increments `_fetchCompleted` and triggers re-render via `_onFetchComplete`.
- `modelRef.paramB` / `modelRef._paramSource` — Parameter count and resolution method stored directly on each tree model ref. Replaces the previous `_paramCache`/`_paramSource` parallel Maps, eliminating maintenance overhead and ~1.4MB of side-map memory.
- `_apiTimestamps` — Sliding window enforcing ≤4 req/s (1 call per 250ms, no burst). Managed inside `_dequeueNext`, not in `fetchJson`.
- `_modelTree` — Single source of truth for fetched models and hierarchy. Holds the root node plus lookup maps (`byPath`, `byModelId`, `authorByLower`).
- `sliderFrom/sliderTo` — 0..80 (0=Anytime, 1-79=14-day increments, 80=Now).
- `paramSliderFrom/paramSliderTo` — 0..220 (piecewise linear 7-segment mapping).
- `_popupTimers` — `Map<popupEl, timeoutId>` for debounced popup show/hide (150ms show, 200ms hide).

---

## Architecture Decisions

### Render Pipeline

Two-tier rendering separates progressive feedback from structural DOM rebuilds:

- **Progressive UI Layer** (`UI` object): Provides `setStatus`, `updateCellBadge`, and `queueUpdate` for immediate visual feedback without touching table structure. Batch micro-updates via rAF-gated `_pendingUpdates` queue to avoid layout thrashing.
- **Structural Renders** (`RenderCoordinator` / `RC`): Handles full table rebuilds via `requestRender()` → `_doFullRender()`. Synchronous-only, guarded by `_isRendering` re-entrancy barrier. RAF coalescing ensures at most 1 render/frame.

`_asyncDeepenPass()` runs post-render for async deepening of expanded sections outside the synchronous pipeline. `_schedulePostDeepenRender(author, gen)` triggers a structural render only when param resolution changes the set of displayed canonical L2 model IDs under the author (compares the pre/post filter sets, not just counts, to catch swap-in/swap-out scenarios where the total stays the same).

`refreshAllExpanded(force, allowAsync = true, authorFilter = null)`: The `allowAsync` parameter distinguishes user-triggered refreshes (`true`, deepens via `refreshAuthorL2Section`) from structural-pass re-renders (`false`, renders L2 from cache without deepening). When `authorFilter` is set, only that author's subtree is re-expanded via O(1) Map lookup on `_modelTree.root.children`, avoiding a full scan of all authors.

**SkipL1Sort**: `_schedulePostDeepenRender` calls `RC.requestRender(null, true)` with `skipL1Sort=true` to prevent author rows jumping during param resolution. The flag is overwritten by the last `requestRender` before rAF fires — a user action (filter change, sort click) sets it to `false`, ensuring user intent takes priority.

### Generation Counter vs AbortController

Chosen over AbortController because it guards post-fetch side effects (tree mutations, cache writes, render) not just the fetch itself. The queue manager checks generation both when dequeuing and post-fetch, rejecting stale items early. All call sites use `isStale(gen)` helper — never bare comparisons.

### Queue-Based API Request Manager

Callers push work items via `fetchJson()`; `_dequeueNext` gates on both in-flight count (`INFLIGHT_MAX=5`) and time window (1 call/250ms = 4 req/s). Failed retries don't increment API counter; only successes and permanent failures do. Retriable errors re-enqueue at tail after backoff delay to compete fairly.

### Param Resolution Pipeline

Deterministic 3-step pipeline in `tryResolveModelParam`: name regex → parent inheritance (iterative suffix strip) → child search API (`resolveParamFromChildren`). Free paths are always exhausted first; the expensive child-search path is an absolute last resort. Models resolved via child-name inference get a purple (`derived-param`) badge; parent inheritance gets a white/gray (`parent-inherit-param`) badge; child-data resolution gets a goldenrod (`child-data-param`) badge. Re-attempt suppression is stored on each model object (`model._inferredAttempted`).

`resolveParamFromChildren` uses early exit: stops after 3 non-null results agreeing on the current max (up to `DERIVED_BATCH_SIZE`=6). Once confidence is established, further fetches are wasteful. Tries `extractParamFromId` on each child's ID before making the individual API fetch — most quant names contain B/M patterns, so the individual fetch is rarely needed.

### Deepening Sequencing

`refreshAuthorL2Section` is `async` and awaits `deepenBatch` (individual API fetches for models without metadata) before running the `_derivedParamEnabled` child-search pass. This eliminates a race where both paths could set `m.paramB` concurrently with no ordering guarantees — previously parent models could inherit incorrect params from children.

### Same-Author Fine-Tunes

`isBase()` treats same-author fine-tunes as base models so they appear at L2 under their author. `loadChildren()` skips them at L3 and labels cross-author fine-tunes as "finetune". This prevents duplicate display while preserving the hierarchy.

### Two-Phase Search in loadChildren

First try model name alone (covers quant suffixes), fall back to full parent ID. `strictNameMatch` strips known quant suffixes from candidate IDs before comparing, so Qwen2.5-7B-GGUF matches a search for "Qwen2.5-7B". Same-author fine-tunes are skipped (already shown at L2). Cross-author fine-tunes without explicit base_model are included if they pass `strictNameMatch` and `isQuant`; visibility is controlled entirely by `runFilterPipeline`.

### Two-Pass Base Model Injection

Scan in-memory tree models, identify parent IDs not yet present, then fetch those parents independently through the API manager queue. Progressive re-render via `onBatch()` callback after each completion.

### Tree-Backed Memory Management

Models are stored once as `modelRef` objects in `_modelTree` nodes and indexes (`byModelId`/`byPath`). Parameter counts and resolution metadata live directly on each `modelRef` (`paramB`, `_paramSource`), so there is no separate param cache to maintain or evict.

### normalizeModel — Field Stripping

Intentionally drops: sha, siblings, config, library_name, private, and all other API fields. `pipeline_tag` is preserved as-is from the source object (with a safety backfill in `_mergeRequestResult` for edge cases where the API omits it). The HF API returns ~40 fields per model; keeping only the normalized subset materially reduces memory footprint. Add fields back only when a concrete feature requires them.

### Full=true&cardData=true on Every Fetch

The HF search API never returns safetensors/gguf metadata or cardData without `full=true`. This is the only way to get `base_model` info for hierarchy resolution. Memory-vs-API-calls tradeoff: fetching light payloads initially and lazy-loading details would multiply API calls by ~5-10x.

### Popup System

Debounced show/hide: 150ms show delay prevents flicker on accidental mouse passes; 200ms hide delay (`CONFIG.DEBOUNCE_MS`) gives enough time to move from trigger into popup content. `positionPopupCenter` runs inside the setTimeout callback (not synchronously on mouseenter) to avoid stale `getBoundingClientRect()` values during debounce. Scroll/resize listeners clear all pending timers and hide visible popups as defense against stale positioning. `_cachedWidth` stores computed width for re-show performance, invalidated in `hideAllPopups()` to prevent measurements from becoming stale after page content changes.

`.filter-popup` uses `z-index: 1000` with sticky table headers at lower z-indices (100, 90, 80, 70). `isolation` is intentionally NOT used on popups — it breaks the stacking context and causes popups to render behind sticky headers.

Popup trigger/popup IDs are generated by `makePopupTrigger(suffix, ...)` which centralizes the `/` → `__` replacement for valid HTML IDs. Returns `.wire()` for post-innerHTML setup.

### Popup Source Consistency

L2/L4 hidden count and popup hidden count must match exactly. `popupSource` passed to `renderL2` must be the same array that `totalBeforeFilter` was computed from (typically `nonQuantBase`). L2 label says "hidden by current filters" and counts models removed by ALL filters, with popup showing all hidden (no sample cap). L4 says "hidden by text filter" and counts only text-filtered models, popup capped at 200 samples. This difference is intentional: L2 filters are many and layered (sliders + chips + text), while L4 only has the text filter.

`totalBeforeFilter` for L2 is now derived from `l1Node.totalChildren` (computed during `walkFilterL1` as the count of canonical L2 models), not passed as a render parameter. The filter pipeline stores all visibility decisions statically on tree nodes (`display`, `totalChildren`, `aggMaxLastModified`, and decomposed `_filter*` booleans), so renderers read state instead of re-evaluating predicates.

**Performance-cached fields:** The filter pipeline also pre-computes expensive string operations and stores them on nodes to avoid redundant work during render:
- L2 nodes carry `_orphanQuantMethods` (set by `walkFilterL2`), read by `buildL2TableHtml` for orphan badge rendering and by `passesTreeNodeFilters` to avoid re-running regex matching.
- L4 nodes carry `_quantFilterString` (set by `walkFilterL4`), read by `renderL3` and `renderL4` instead of re-running `getQuantFilterString()` (which does regex matching + tag iteration) per child.
- L3 `count` and `totalDownloads` are always computed from the `displayedL4` array in `renderL3` (not read from `l3Node.aggCount` / `aggDownloads`) so they remain correct after dynamic child loads without requiring a full `runFilterPipeline` re-run.

**Reverse indices for O(n) ingestion:** `_modelTree` maintains one additional index beyond `byModelId`:
- `byModelName` (Map: `displayName → L2Node[]`) — used by `recomputeCanonicalForName` to find canonical dedup candidates in O(k) where k = models with that name, replacing the previous O(n) full scan over all L2 nodes.

`byModelId` itself uses lowercase keys so lookups are case-insensitive without a separate index. This is a deliberate design decision: HF IDs are case-sensitive, but derivative authors (and occasionally base model authors) use inconsistent casing for the same model, causing mismatches. Treating all IDs case-insensitively works around this common issue.

**displayName precomputation:** `normalizeModel` computes `displayName` (`id.split('/').slice(1).join('/')`) and `displayNameLower` at ingestion time. All render and filter hot paths read these cached fields instead of repeatedly splitting and lowercasing model IDs.

`renderL3` and `renderL4` walk the tree directly via `_modelTree.byModelId.get(parentId)` → L2 → L3 → L4 iteration. No intermediate `getTreeChildren()` array allocation. L3 computes `maxLastModified` at render time from the `displayedL4` array (matching how `count` and `totalDownloads` are derived) rather than reading the stale `l3Node.aggMaxLastModified` set by `walkFilterL3`. If no displayed children have a date, it falls back to the L2 parent model's `lastModified`.

### Clear Cache + Generation Guard

Clears all caches via `resetAppState()` and increments `_fetchGeneration` to abort stale async. Unlike `applyFilters`, collapses all expanded sections (no cached data to restore from). Resets `apiCalls`, `_totalBytesReceived`, `_consecutive429s` counters together. Also resets `_dequeueScheduled` so the queue manager can resume cleanly. Rejects all queued items before truncation to prevent promise leaks.

**AbortControllers on reset:** `_inflightControllers` (Map: `url → AbortController`) tracks every active HTTP request. On Clear Cache, all controllers are aborted, rejected promises are caught by `.catch`, and `_inflightCount` decrements naturally. Previously `_inflightCount` was zeroed directly, which caused negative counts when the aborted requests later decremented in their `finally` paths, breaking the `INFLIGHT_MAX` gate.

**RAF / progressive state reset:** `RC._renderScheduled`, `RC._isRendering`, `UI._pendingUpdates`, `UI._flushScheduled`, and `_uiRafId` are all cleared so stale animation frames cannot fire on a destroyed tree.

**Popup timer cleanup:** `_popupTimers` entries are deleted after the hide timer fires, preventing detached DOM elements from leaking via strong Map references. `hideAllPopups()` clears pending timers proactively on scroll/resize.

**detailSort eviction:** `RC._state.detailSort` is capped at 100 entries (FIFO eviction in `handleSortClick`) to prevent unbounded growth during long exploration sessions.

### Forward-Reference Method Wiring

RenderCoordinator (Section 2) declares `renderL1: null`, `updateArrows: null`, etc. — assigned in Section 7 after the DOM render functions exist. This violates strict top-down dependency ordering but is a deliberate pattern for concern-based section layout in single-file apps: Section 2 owns all state management, Section 6 owns the render pipeline functions, and Section 7 bridges the two. Methods are only called after `_initApp()` completes, so the forward references are safe in practice.

### HTML Escaping — Object-Lookup Optimization

Single-pass replacement via lookup table is faster than chained `.replaceAll` calls. Used throughout for XSS-safe interpolation of model IDs and author names.

### B/M Param Extraction Sanity Guard

No real model has <1M or >2T params. The regex already has a negative lookbehind guard; this extra check catches anything that passes the regex but is still clearly wrong (e.g., 0.0005B or 5000B).

---

## UI Design

### Dark Theme Is Fixed

No light/dark toggle is planned. Hardcoded color values are intentional for consistency. CSS variableization would add complexity without benefit for a single-theme app.

### Native Button Elements

All interactive elements (filter chips, task tags, clear buttons, popup triggers) use native `<button type="button">` rather than `<span role="button">`. Provides better screen reader announcements, default `:focus-visible` outlines, and native Enter/Space handling without JS boilerplate. CSS resets are applied for button defaults (padding, border, background).

### Zebra Striping

L1/L2/L3 rows use `row-even`/`row-odd` classes for alternating row backgrounds.

### Slider Tooltip Alignment

Date-slider From uses `align-right` (sits left of knob), To uses `align-left` (sits right of knob). Param-slider uses centered (no alignment class). Fixed per-knob alignment prevents tooltip text from overlapping when knobs are close — dynamic alignment based on position would flip them inward, merging the text. Tooltips are hidden entirely on narrow screens (≤600px CSS media query) where overlap risk is highest.

### CSS Selector Consolidation

Filter bar containers carry a `chip-group` class; selector rules use `.chip-group .filter-chip` rather than repeating selectors per filter bar location.

---

## Filter Architecture

Two-tier update pipeline:

- **Instant (In-memory) path**: Text inputs and sliders apply instantly via debounced callbacks (`debouncedTextFilter`, `debouncedSliderUpdate`). These re-render from in-memory state only — no API calls, no generation bump. Changes are visible immediately but reflect only already-fetched data.
- **Deferred (API-triggering) path**: From/To bar changes and special chip toggles call `markDirty()` which bumps the generation counter and triggers fresh API fetches on next "Get Results".

L2 text filter is applied globally in `passesTreeNodeFilters()` before L1 aggregation (affects L1 counts). `_l3AuthorFilter`/`_l4ModelFilter` apply only at their respective render levels.

---

## Configuration Reference

| Key | Value | Rationale |
|-----|-------|-----------|
| `RATE_LIMIT` | 250ms | 4 req/s minimum gap; prevents HF rate limiting |
| `INFLIGHT_MAX` | 5 | Browser per-origin limit is ~6; leaves headroom for favicon etc. |
| `ALL_FETCHED_MAX` | 16384 | Memory cap, trimmed by lastModified descending |
| `AUTHOR_LIMIT` | 1000 | Max models fetched per author API call |
| `DERIVED_BATCH_SIZE` | 6 | Max children searched in `resolveParamFromChildren` (early exits at 3 agreeing) |
| `DEBOUNCE_MS` | 200 | Popup hide delay; gives time to move cursor from trigger into popup content |
| `POPUP_MAX_SAMPLES_L4` | 200 | L4 hidden models preview cap; L2 shows all with no cap |

---

## Rejected Approaches

- **Queue microtask starvation**: Guard flag (`_dequeueScheduled`) prevents timer stacking; rate limiter enforces 250ms minimum gap. Switching to `queueMicrotask` would block paint opportunities and compound delays.
- **L2/L3/L4 render deduplication**: Level-specific differences (badges, popups, expansion/collapse cascade, data flow) require ~10+ callback parameters in a generic helper — reduces readability more than duplication costs.
- **JSDoc annotations**: Adds bulk to a single-file app with existing design notes and self-documenting naming conventions. No runtime benefit.
- **IntersectionObserver lazy loading**: High complexity for marginal UX gain. Click-to-expand model works well; pre-fetching wastes API calls on models users never expand.
