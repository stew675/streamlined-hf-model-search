# AGENTS.md — Streamlined HF Model Search

## Project Overview

Single-file, zero-dependency HTML/JS app that explores HuggingFace base models in a 4-level hierarchy. All logic lives in `streamlined-hf-model-search.html`.

## File Structure

```
streamlined-hf-model-search.html   — Single-file app (HTML + CSS + JS)
README.md                — User documentation
AGENTS.md                — This file
IMPROVEMENTS.md          — Code review tracking
```

## Architecture

### Data Flow
1. **Init**: Wait for user to click "Get Results". Compute active pipeline tags from From/To filter bars → fetch top 500 models per pipeline task (both `sort=downloads` and `sort=lastModified`, merged) → deduplicate → inject cross-author base models referenced by `cardData.base_model` → store all in `_allFetched` (trimmed to `ALL_FETCHED_MAX`=16,384 entries by `lastModified` descending).
2. **Render**: `computeAuthorData()` applies date + param slider ranges and From/To/Special/Quant filters to `_allFetched` → groups by author → renders L1.
3. **L1 expand**: Fetch full author model list (1000) → filter base models (including same-author fine-tunes) → cache full list → apply date + param slider filters → render L2 → deepen unknown `paramB` in batches of 5 via individual model API (only for models that pass the date/param filters). After deepening, a second pass strips quant suffixes from still-unknown model IDs and inherits `paramB` from the parent (looked up in the locally-resolved `baseModels` or `_allFetched`).
4. **L2 expand**: Search HF API for children by parent ID and model name → match on `cardData.base_model` or quant tags. Same-author fine-tunes are excluded (already shown at L2). Cross-author fine-tunes are labeled "finetune".
5. **L3/L4**: Group children by quant author, apply active quant filters, render sortable table.

### State Management
- `_allFetched` — All base models fetched during init (trimmed to 16k, no date/param filter applied before storage)
- `_authorData` — L1 author records (mutable, updated on L1 expand, slider changes)
- `_canonicalAuthor` — Map of model name → canonical author; computed lazily and cached via `_canonicalCache`
- `_fetchGeneration` — Monotonically increasing counter; all async operations capture it at entry and bail early if stale
- `_injectedBaseIds` — Set of model IDs marked as injected (bypass date filter to keep recently-updated quants reachable via their parent)
- `_inflightChildren` — Map `{parentId → Promise}` to deduplicate concurrent L3/L4 fetches
- `_apiTimestamps` — Sliding window for API rate limiting (max 10 req/s)
- `cache` — Global in-memory LRU cache (max `CACHE_MAX`=50 entries) keyed by:
  - `"{author}"` → L2 base models array
  - `"{author}_models"` → raw API response for author
  - `"children-{parentId}"` → L3/L4 children array
- `cacheSet(key, val)` / `cacheAccess(key)` — Cache accessors; `cacheAccess` promotes the key to most-recently-used
- `detailSort` — Per-section sort state keyed by `"l2-{idx}"`, `"l3-{l2}-{model}"`, `"l4-{l2}-{model}-{g}"`
- `expandedSections` — Set of `"a|{author}"`, `"m|{modelId}"`, `"g|{parentId}|{author}"` keys tracking open rows
- `activeFilters` — Set of enabled quant type strings (awq, fp4, fp8, finetune, gguf, mlx, safetensors, others)
- `activeFromFilters` / `activeToFilters` — Sets controlling which pipeline tags resolve
- `activeSpecialFilters` — Set for special toggles (include untagged)
- `activeTaskFilters` — Set of pipeline tags the user has explicitly selected via the activated types bar
- `sliderFrom` / `sliderTo` — Date slider positions (0..80, where 0=Anytime, 1-79=YYYY/MM/DD with 14-day increments, 80=Now)
- `paramSliderFrom` / `paramSliderTo` — Param size slider positions (0..220, mapped via piecewise linear 7-segment mapping)

### Key Functions

| Function | Purpose |
|----------|---------|
| `renderMain(authorData)` | Renders L1 author table |
| `renderL2(idx, models, container)` | Renders L2 base models |
| `renderL3(l2Idx, modelIdx, parentId, children, container)` | Renders L3 quant author groups |
| `renderL4(l2Idx, modelIdx, gIdx, quants, container)` | Renders L4 individual quants |
| `loadAuthorModels(idx, author, container)` | Async fetch for L2, deepens unknown `paramB` in batches of 5; post-deepening parent lookup for quant models without B/M suffix |
| `loadChildren(l2Idx, modelIdx, parentId, container)` | Async fetch for L3/L4 (two search queries, deduplicated via `_inflightChildren`) |
| `refreshAllExpanded()` | Re-renders all open sections (filter/slider changes) |
| `matchesFilter(qMethod)` | Checks if a quant method passes active filters |
| `computeAuthorData()` | Applies date/param/From/To/Special/Quant filters to `_allFetched`, groups by author |
| `isBase(model)` | Checks if a model is a base model (no `cardData.base_model`, or same-author fine-tune) |
| `isInDateRange(createdAt)` | Date slider range check (null dates pass through) |
| `isInParamRange(paramB)` | Param slider range check |
| `getParamCount(model)` | Extracts param count from `safetensors.total`, `gguf.total`, or B/M suffix in model ID. Returns null for quant models without a B/M in the name, which are resolved via individual API fetch or parent lookup |
| `paramValueToLabel(val)` | Formats param count for display (int ≥5B, 1 decimal ≥1B, int M <1B) |
| `buildDateSlider()` | Builds the date dual-range slider |
| `buildParamSlider()` | Builds the param size dual-range slider |
| `sortCoerce(v, k)` | Coerces a value to a comparable type for sorting (numeric, Date timestamp, or lowercase string) |
| `sortRows(rows, key, asc, subKey?)` | Generic sort for any level; uses `sortCoerce` for consistent coercion |
| `updateArrows()` | Updates sort arrow indicators on L1 table header |
| `resolveTasks()` | Computes active pipeline tags from From/To filter bars |
| `fetchJson(url)` | Rate-limited fetch wrapper (≤10 req/s), retries up to 3× with exponential backoff for 429/5xx/network errors |
| `cacheSet(key, value)` | Stores entry in global LRU cache |
| `cacheAccess(key)` | Retrieves entry and promotes it to most-recently-used |
| `escapeHtml(str)` | Single-pass HTML entity encoding via `_htmlEsc` lookup map |

### Constants

- `TO_TAGS` — 44 pipeline tag definitions with `from` and `to` modalities
- `FROM_OPTIONS` — `["text", "image", "audio", "video", "any", "all"]`
- `TO_OPTIONS` — `["text", "speech", "audio", "image", "video", "3d", "any", "all"]`
- `CONFIG` — Object with all tunable parameters:
  - `LIMIT: 500` — Models fetched per task (both `sort=downloads` and `sort=lastModified`)
  - `PARAM_SLIDER_MAX: 220` — Maximum param slider position
  - `RATE_LIMIT: 10` / `RATE_WINDOW: 1000` — API rate limiting
  - `FETCH_TIMEOUT: 60000` / `MAX_RETRIES: 3` — Fetch resilience
  - `DATE_SLIDER_MAX: 80` / `DAYS_PER_STEP: 14` — Date slider
  - `PARAM_BATCH_SIZE: 5` / `PARAM_MIN_GAP: 5` — Deepening batches
  - `AUTHOR_LIMIT: 1000` / `CHILD_LIMIT: 1000` — Max results per endpoint
  - `DEBOUNCE_MS: 200` — Slider debounce
  - `CACHE_MAX: 50` — Max LRU cache entries
  - `ALL_FETCHED_MAX: 16384` — Max `_allFetched` entries (oldest dropped by date)
- `Q_METHODS` — All quantization keywords for detection (awq, gptq, bitsandbytes, eetq, aqlm, gguf, exl2, marlin, mlx, bnb, fp4, fp8, nf4, int8, int4, q8, q4)
- `FILTER_DISPLAY` — Subset shown in filter bar (awq, fp4, fp8, finetune, gguf, mlx, safetensors, others)
- `DEFAULT_ACTIVE_TAGS` — Pipeline tags enabled by default on initial load

## Conventions

- **No external dependencies** — everything inline
- **No comments in code** — keep it compact
- **Dark theme** — GitHub/HF color palette (`#0d1117`, `#161b22`, `#58a6ff`, etc.)
- **Indentation** — 2 spaces
- **Event delegation** — attach one listener per container after first `innerHTML` injection (`_delegatedL2` / `_delegatedL3` / `_delegatedL4` flag); state stored in `_lXState` on the container
- **ID scheme** — `t{level}-{idx}` for toggles, `d{level}-{idx}` for detail rows, `i{level}-{idx}` for inner containers
- **Level discrimination** — `<th>` elements carry `data-level="2|3|4"` so sort handlers can reject events from nested levels even after `innerHTML` detaches the target from the DOM
- **Generation guard** — All async functions that mutate shared state capture `const gen = _fetchGeneration` at entry and check `if (gen !== _fetchGeneration) return;` before any side-effect. Applied in `applyFilters`, `injectBaseModels`, `loadAuthorModels`, and the `onBatch` callback.

## Testing

Open `streamlined-hf-model-search.html` in a browser. Validate:
1. L1 loads with authors and counts after clicking "Get Results"
2. Changing From/To filters changes activated pipeline tags
3. Clicking an author expands to L2 with matching count
4. Clicking a base model expands to L3 (quant author groups)
5. Clicking a quant author expands to L4 (individual models)
6. Quant filter chips (AWQ, FP4, FP8, FINETUNE, GGUF, MLX, SAFETENSORS, OTHERS) update all expanded sections
7. Column headers toggle sort direction
8. Links open model pages in new tabs
9. Date slider changes re-render L1 and all open L2 sections
10. Param slider changes re-render L1 and all open L2 sections
11. L2 shows "Params" column; unknown params fetch in batches of 5 with loading indicator
12. API call counter updates and rate limiting stays ≤10 req/s
13. L4 sort by Model ID doesn't collapse L4 content
14. GGUF models without B/M suffix in name (e.g. `Qwen/Qwen3-Coder-Next-GGUF`) show inherited param count from their parent after deepening
15. Rapid double-clicking "Get Results" or rapidly expanding/collapsing L2 rows does not produce stale renders or duplicate API calls (generation guard and inflight dedup)
16. `_allFetched` does not exceed 16,384 entries (oldest models dropped by `lastModified`)

## Common Pitfalls

- **Data attribute names**: `data-l3-model-idx` ≠ `data-l3-model`. Always verify matching.
- **ID collisions**: L3/L4 IDs include all parent indices (`d3-{l2}-{model}-{g}`).
- **Filter refresh**: `refreshAllExpanded` queries DOM for visible detail rows via `expandedSections` Set — must cascade-delete descendant IDs on parent collapse to avoid re-rendering orphaned sections.
- **Cache keys**: `children-{parentId}` uses the full model ID (e.g., `Qwen/Qwen2.5-7B`). Cache is LRU with 50-entry max.
- **Author name stripping**: L2 displays `m.id.split("/").slice(1).join("/")` to avoid repeating the author.
- **L1 sort selector**: Uses `#main-table > thead > tr > th` to avoid L2/L3 nested `<th>` triggering. Do NOT delegate to `#main-table thead`.
- **Param deepening**: Only fires for the single author the user expands, in batches of 5, and only for models that pass the current date/param filters — prevents spamming the API for invisible models.
- **Search endpoint limitations**: The search API (`/api/models?search=...`) never returns `safetensors` or `config` data even with `full=true`. The individual model API (`/api/models/{id}?full=true`) does, which is why deepening is needed for models without B/M in their name.
- **Rate limiting**: `fetchJson` uses a sliding-window rate limiter (10 calls/sec). Failed retries do not count toward the API call counter; only successes and permanent failures increment.
- **Generation guard**: Async functions check `_fetchGeneration` before side-effects. If the generation counter advances (user clicks "Get Results" again), stale async work skips all mutations. Always capture `const gen = _fetchGeneration` at the very start of any async function that touches shared state.
- **Detached event target**: Sort handlers capture `const inner = e.target.closest(".detail-inner")` in a variable before any `innerHTML` replacement (which detaches the event target, making `closest()` return null). Combined with `data-level` attribute on `<th>`, both toggle and sort paths are correctly guarded even after DOM detachment.
- **Same-author fine-tunes**: `isBase()` treats same-author fine-tunes as base models (e.g., `Qwen/Qwen3.5-9B` is a fine-tune of `Qwen/Qwen3.5-9B-Base` but both author = "Qwen", so both appear at L2). `loadChildren()` skips same-author fine-tunes at L3 (already at L2) and labels cross-author fine-tunes as "finetune".
- **Parent param inheritance**: GGUF/AWQ/GPTQ quant models without B/M in their name (e.g. `Qwen/Qwen3-Coder-Next-GGUF`) get `paramB` from their parent via the post-deepening pass. The parent must be in the same `baseModels` array (same author) or `_allFetched`. Stripping is iterative — removes trailing `-segment` one at a time until a known parent is found.
- **Inflight dedup**: `_inflightChildren` map (`children-{parentId}` → Promise) prevents duplicate L3/L4 fetches. The promise is set synchronously before the first `await`, so concurrent calls always reuse the same inflight request.
