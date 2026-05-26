# AGENTS.md — Streamlined HF Model Search

## Project Overview

Single-file, zero-dependency HTML/JS app that explores HuggingFace base models in a 4-level hierarchy (Author → Base Model → Quant Author → Quant). All logic lives in `streamlined-hf-model-search.html`.

## Editing AGENTS.md

When modifying this file, write the new content to a temporary file (e.g. `AGENTS.md.new`) and only copy it back to `AGENTS.md` when all edits are complete. This minimizes LLM context churn from many small sequential edits against the same file.

## Data Flow

1. **Init** (Get Results click): Resolve pipeline tags from From/To bars → fetch top 500 models per task (both `sort=downloads` and `sort=lastModified`, merged, concurrency-capped at 5) → dedup → also fetch trending (1000) and untagged models → inject cross-author base models from `cardData.base_model` → store in `_allFetched` (trimmed to 16,384 by `lastModified` descending).
2. **Canonical dedup**: `buildCanonicalAuthors()` — when a model name appears under multiple authors, keep only the highest-download variant.
3. **Orphan/nested suppression**: Quants whose parent exists in `_allFetched` but has no explicit `cardData.base_model` are suppressed from L1 (`isOrphanQuant`, name-based inference). Nested quants pointing to another quant rather than a true base are suppressed (`isNestedQuant`).
4. **Render**: `computeAuthorData()` applies date/param sliders, From/To/Special/Quant filters, canonical dedup, and orphan/nested suppression → groups by author → renders L1.
5. **L1 expand** → `loadAuthorModels()`: fetch 1000 author models → filter base models (including same-author fine-tunes) → render L2 → deepen unknown `paramB` in batches of 4 via individual model API.
6. **L2 expand** → `loadChildren()`: search HF API for children by parent ID + name → match on `cardData.base_model` or quant tags. Same-author fine-tunes at L2 only; cross-author at L3 labeled "finetune". Deduplicated via `_inflightChildren`.
7. **L3/L4**: Group children by quant author, apply quant/text filters, render sortable table. `_l2ModelFilter` is applied globally in `modelPassesAllFilters()` before author grouping (affects L1 counts); `_l3AuthorFilter`/`_l4ModelFilter` apply only at their respective render levels.

## Non-Obvious State

- `_fetchGeneration` — Monotonically increasing counter incremented by "Get Results" and "Clear Cache". All async functions capture `const gen = _fetchGeneration` at entry and bail if stale — prevents stale renders without AbortController (which can't guard post-fetch side effects like cache writes).
- `_inflightChildren` — `Map<parentId, {promise, results}>` to deduplicate concurrent L3/L4 fetches; results stored directly in the entry to survive LRU cache eviction.
- `_inflightFetches` — `Map<url, promise>` to deduplicate concurrent `fetchJson` calls before they reach the rate limiter.
- `_paramCache` — `Map<modelId, paramB>` persists across renders; cleared only by Clear Cache. Bound by unique models encountered (~1.4MB at 16k entries).
- `cache` — In-memory LRU (500 entries) keyed by `"{author}"`, `"{author}_models"`, `"children-{parentId}"`. Uses `cacheSet`/`cacheAccess`.
- `_apiTimestamps` — Sliding window enforcing ≤4 req/s (1 call per 250ms, no burst).
- `_injectedBaseIds` — Injections bypass the date slider so recently-updated quants remain reachable via their parent.
- `sliderFrom/sliderTo` — 0..80 (0=Anytime, 1-79=14-day increments, 80=Now).
- `paramSliderFrom/paramSliderTo` — 0..220 (piecewise linear 7-segment mapping).
- `_popupTimers` — `Map<popupEl, timeoutId>` for debounced popup show/hide (150ms show, 200ms hide).

## Backward-Compatible Proxies

Removed in v260525.21 — all callers now access `RenderCoordinator._state`, `_levelState`, and helper methods (`getDetailSort`, `expandedSections`) directly. No indirection remains.

## Render Pipeline

`requestRender()` (batched via `requestAnimationFrame`) → `_doFullRender()`: syncSortState → computeAuthorData → renderL1 → updateArrows → pruneExpiredExpansions → saveRestoreExpansions (only when `saved` non-null; typically passed by `recomputeAndRender`) → refreshAllExpanded (L2→L3→L4 cascade) → [optional] deriveVisibleUnknowns.

## Conventions

- **No external dependencies** — everything inline.
- **Indent**: 2 spaces.
- **Event delegation**: One listener per container after `innerHTML` injection (`_delegatedL2`/`_delegatedL3`/`_delegatedL4` flag); state stored in `_lXState` on the container. Toggle `<button type="button">` for native keyboard Enter/Space handling.
- **ID scheme**: `t{level}-{idx}` (toggles), `d{level}-{idx}` (detail rows), `i{level}-{idx}` (inner containers).
- **Level discrimination**: `<th>` elements carry `data-level="2|3|4"` so sort handlers reject events from nested levels even after `innerHTML` detaches the target from the DOM.
- **Generation guard**: All async functions that mutate shared state capture `const gen = _fetchGeneration` at entry and check `if (gen !== _fetchGeneration) return;` before any side-effect.
- **CSS.escape**: Any query selector interpolating user-controlled strings (author names, model IDs) must use `CSS.escape()` to prevent broken queries or injection.

## Testing

Open in browser, validate:
1. L1 loads with authors and counts after "Get Results"
2. From/To filter bars change activated pipeline tags
3. Author → L2, base model → L3, quant author → L4 all expand correctly
4. Quant filter chips update all expanded sections
5. Column headers toggle sort direction
6. Links open in new tabs
7. Date/param sliders re-render L1 + all open L2 sections
8. Unknown params in L2 Params column fetch in batches of 4 with loading indicator
9. API call counter ≤4 req/s (1 call per 250ms window)
10. L4 sort by Model ID doesn't collapse L4 content
11. Missing B/M suffix models (e.g. `Qwen/Qwen3-Coder-Next-GGUF`) inherit parent params after deepening
12. Same-author quants appear at L2 under their author (not silently suppressed)
13. Rapid double-clicks don't produce stale renders or duplicate API calls
14. Hidden Models Preview popups: appear at L2/L4 on hover, center over trigger with boundary clamping, stay visible when moving mouse into popup, links clickable
15. Popup hidden count matches L2/L4 trigger count exactly; L2 popup shows all hidden models (no sample cap)
16. Popup sortable columns: click any header to sort, ▲/▼ arrows indicate sort direction
17. "Hide Missing Params" chip hides param-less models from L1/L2
18. API counter flashes amber on 3+ consecutive 429s
19. Clear Cache clears everything, preserves filter/slider state
20. `_allFetched` does not exceed 16,384 entries

## Common Pitfalls

- **Data attribute names**: `data-l3-model-idx` ≠ `data-l3-model`. Always verify matching.
- **ID collisions**: L3/L4 IDs include all parent indices (`d3-{l2}-{model}-{g}`).
- **Filter refresh**: `refreshAllExpanded` queries DOM via `expandedSections` Set — must cascade-delete descendant IDs on parent collapse to avoid re-rendering orphaned sections.
- **Cache keys**: `children-{parentId}` uses the full model ID (e.g., `Qwen/Qwen2.5-7B`). LRU capped at 500 entries.
- **Author name stripping**: L2 displays `m.id.split("/").slice(1).join("/")` to avoid repeating the author.
- **L1 sort selector**: Uses `#main-table > thead > tr > th` to avoid L2/L3 nested `<th>` triggering. Do NOT delegate to `#main-table thead`.
- **Param deepening**: Only fires for the single expanded author, in batches of 4, and only for models passing current date/param filters.
- **Search endpoint limitations**: Search API (`/api/models?search=...`) never returns `safetensors` or `config` data even with `full=true`. Individual model API does — hence deepening for models without B/M suffix.
- **Rate limiting**: `fetchJson` uses sliding window (1 call/250ms = 4 req/s, no burst). Failed retries don't increment API counter; only successes and permanent failures do.
- **Generation guard**: Always capture `const gen = _fetchGeneration` at the very start of any async function that touches shared state. Check before side-effects.
- **Detached event target**: Capture `const inner = e.target.closest(".detail-inner")` in a variable before any `innerHTML` replacement (which detaches the target, making `closest()` return null). The `data-level` attribute on `<th>` provides a secondary guard.
- **Same-author fine-tunes**: `isBase()` treats them as base models. `loadChildren()` skips them at L3 and labels cross-author fine-tunes as "finetune".
- **Parent param inheritance**: GGUF/AWQ/GPTQ quants without B/M suffix get `paramB` from parent via post-deepening pass. Stripping removes trailing `-segment` iteratively until a known parent is found (same author's `baseModels` or `_allFetched`).
- **Early-exit in param resolution**: `resolveParamFromChildren` stops after 3 non-null results agreeing on the current max (up to `DERIVED_BATCH_SIZE`=10).
- **Inflight dedup**: `_inflightChildren` entries set synchronously before the first `await`; concurrent callers read results directly from the entry, bypassing evictable LRU cache.
- **Cache eviction fallback**: When `children-{parentId}` is evicted from LRU cache, L3 falls back to `s.children` from `l3StateMap` (survives eviction).
- **Clear Cache + generation guard**: Clears all caches and increments `_fetchGeneration` to abort stale async. Unlike `applyFilters`, it collapses all expanded sections (no cached data to restore from).
- **Popup source consistency**: L2/L4 hidden count and popup hidden count must match exactly. `popupSource` passed to `renderL2` must be the same array that `totalBeforeFilter` was computed from (typically `nonQuantBase`).
- **L2 vs L4 hidden labels**: L2 label says "hidden by current filters" and counts models removed by ALL filters (date, param, pipeline, text, etc.), with popup showing all hidden (no sample cap). L4 says "hidden by text filter" and counts only text-filtered models, popup capped at 200 samples. This difference is intentional: L2 filters are many and layered (sliders + chips + text), while L4 only has the text filter.
- **Popup ID sanitization**: L4 popup IDs replace `/` with `__` in parentId (`l4SafeId`) to produce valid HTML IDs. Trigger and popup must use the same sanitized key.
