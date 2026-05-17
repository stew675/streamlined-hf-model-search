# AGENTS.md — Streamlined HF Model Search

## Project Overview

Single-file, zero-dependency HTML/JS app that explores HuggingFace base models in a 4-level hierarchy. All logic lives in `streamlined-hf-model-search.html`.

## File Structure

```
streamlined-hf-model-search.html   — Single-file app (HTML + CSS + JS)
README.md                — User documentation
AGENTS.md                — This file
```

## Architecture

### Data Flow
1. **Init**: Wait for user to click "Get Results". Compute active pipeline tags from From/To filter bars → fetch top 500 models per pipeline task (both `sort=downloads` and `sort=lastModified`, merged) → deduplicate → inject cross-author base models referenced by `cardData.base_model` → store all in `window._allFetched`.
2. **Render**: `computeAuthorData()` applies date + param slider ranges and From/To/Special/Quant filters to `_allFetched` → groups by author → renders L1.
3. **L1 expand**: Fetch full author model list (1000) → filter base models (including same-author fine-tunes) → cache full list → apply date + param slider filters → render L2 → deepen unknown `paramB` in batches of 5 via individual model API (only for models that pass the date/param filters). After deepening, a second pass strips quant suffixes (`-GGUF`, `-AWQ`, etc.) from still-unknown model IDs and inherits `paramB` from the parent (looked up in the locally-resolved `baseModels` or `_allFetched`).
4. **L2 expand**: Search HF API for children by parent ID and model name → match on `cardData.base_model` or quant tags. Same-author fine-tunes are excluded (already shown at L2). Cross-author fine-tunes are labeled "finetune".
5. **L3/L4**: Group children by quant author, apply active quant filters, render sortable table.

### State Management
- `window._authorData` — L1 author records (mutable, updated on L1 expand, slider changes)
- `window._allFetched` — All base models fetched during init (no date/param filter)
- `cache` — Global in-memory cache keyed by:
  - `"{author}"` → L2 base models array
  - `"{author}_models"` → raw API response for author
  - `"children-{parentId}"` → L3/L4 children array
- `detailSort` — Per-section sort state keyed by `"l2-{idx}"`, `"l3-{l2}-{model}"`, `"l4-{l2}-{model}-{g}"`
- `activeFilters` — Set of enabled quant type strings (awq, fp4, fp8, finetune, gguf, mlx, safetensors, others)
- `activeFromFilters` / `activeToFilters` — Sets controlling which pipeline tags resolve
- `activeSpecialFilters` — Set for special toggles (include untagged)
- `sliderFrom` / `sliderTo` — Date slider positions (0..80, where 0=Anytime, 1-79=YYYY/MM/DD with 14-day increments, 80=Now)
- `paramSliderFrom` / `paramSliderTo` — Param size slider positions (0..220, mapped via piecewise linear 7-segment mapping)
- `_apiTimestamps` — Sliding window for API rate limiting (max 10 req/s)
- `_injectedBaseIds` — Set of model IDs marked as injected (bypass date filter to keep recently-updated quants reachable via their parent)

### Key Functions

| Function | Purpose |
|----------|---------|
| `renderMain(authorData)` | Renders L1 author table |
| `renderL2(idx, models, container)` | Renders L2 base models |
| `renderL3(l2Idx, modelIdx, parentId, children, container)` | Renders L3 quant author groups |
| `renderL4(l2Idx, modelIdx, gIdx, quants, container)` | Renders L4 individual quants |
| `loadAuthorModels(idx, author, container)` | Async fetch for L2, deepens unknown `paramB` in batches of 5; post-deepening parent lookup for quant models without B/M suffix |
| `loadChildren(l2Idx, modelIdx, parentId, container)` | Async fetch for L3/L4 (two search queries) |
| `refreshAllExpanded()` | Re-renders all open sections (filter/slider changes) |
| `matchesFilter(qMethod)` | Checks if a quant method passes active filters |
| `computeAuthorData()` | Applies date/param/From/To/Special/Quant filters to `_allFetched`, groups by author |
| `isBase(model)` | Checks if a model is a base model (no `cardData.base_model`, or same-author fine-tune) |
| `isInDateRange(createdAt)` | Date slider range check (null dates pass through) |
| `isInParamRange(paramB)` | Param slider range check |
| `getParamCount(model)` | Extracts param count from `safetensors.total`, `gguf.total`, or B/M suffix in model ID. Returns null for quant models without a B/M in the name (GGUF, AWQ, etc.), which are resolved via individual API fetch or parent lookup in the post-deepening pass |
| `paramValueToLabel(val)` | Formats param count for display (int ≥5B, 1 decimal ≥1B, int M <1B) |
| `buildDateSlider()` | Builds the date dual-range slider |
| `buildParamSlider()` | Builds the param size dual-range slider |
| `sortRows(rows, key, asc)` | Generic sort for any level |
| `updateArrows()` | Updates sort arrow indicators on L1 table header |
| `resolveTasks()` | Computes active pipeline tags from From/To filter bars |
| `fetchJson(url)` | Rate-limited fetch wrapper (≤10 req/s), retries up to 3× with exponential backoff (1s, 2s, 4s, cap 30s) for 429/5xx/network errors |

### Constants

- `TO_TAGS` — 44 pipeline tag definitions with `from` and `to` modalities
- `FROM_OPTIONS` — `["text", "image", "audio", "video", "any", "all"]`
- `TO_OPTIONS` — `["text", "speech", "audio", "image", "video", "3d", "any", "all"]`
- `LIMIT` — Models fetched per task (500, both `sort=downloads` and `sort=lastModified`)
- `PARAM_SLIDER_MAX` — Maximum param slider position (220)
- `PARAM_VALUES` — 220 positions, 7 segments: 25M steps to 1B, then 100M/200M/1B/2B/10B/20B steps to 1T
- `Q_METHODS` — All quantization keywords for detection (includes fp4, fp8)
- `FILTER_DISPLAY` — Subset shown in filter bar (awq, fp4, fp8, finetune, gguf, mlx, safetensors, others)
- `RATE_LIMIT` — Max API calls per second (10)
- `RATE_WINDOW` — Rate limit window in ms (1000)

## Conventions

- **No external dependencies** — everything inline
- **No comments in code** — keep it compact
- **Dark theme** — GitHub/HF color palette (`#0d1117`, `#161b22`, `#58a6ff`, etc.)
- **Indentation** — 2 spaces
- **Event delegation** — attach one listener per container after first `innerHTML` injection (`_lXDelegated` flag); state stored in `_lXState` on the container
- **ID scheme** — `t{level}-{idx}` for toggles, `d{level}-{idx}` for detail rows, `i{level}-{idx}` for inner containers
- **Level discrimination** — `<th>` elements carry `data-level="2|3|4"` so sort handlers can reject events from nested levels even after `innerHTML` detaches the target from the DOM

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

## Common Pitfalls

- **Data attribute names**: `data-l3-model-idx` ≠ `data-l3-model`. Always verify matching.
- **ID collisions**: L3/L4 IDs include all parent indices (`d3-{l2}-{model}-{g}`).
- **Filter refresh**: `refreshAllExpanded` queries DOM for visible detail rows via `expandedSections` Set — must cascade-delete descendant IDs on parent collapse to avoid re-rendering orphaned sections.
- **Cache keys**: `children-{parentId}` uses the full model ID (e.g., `Qwen/Qwen2.5-7B`).
- **Author name stripping**: L2 displays `m.id.split("/").slice(1).join("/")` to avoid repeating the author.
- **L1 sort selector**: Uses `#main-table > thead > tr > th` to avoid L2/L3 nested `<th>` triggering. Do NOT delegate to `#main-table thead`.
- **Param deepening**: Only fires for the single author the user expands, in batches of 5, and only for models that pass the current date/param filters — prevents spamming the API for invisible models.
- **Search endpoint limitations**: The search API (`/api/models?search=...`) never returns `safetensors` or `config` data even with `full=true`. The individual model API (`/api/models/{id}?full=true`) does, which is why deepening is needed for models without B/M in their name.
- **Rate limiting**: `fetchJson` uses a sliding-window rate limiter (10 calls/sec). Failed retries do not count toward the API call counter; only successes and permanent failures increment.
- **Detached event target**: Sort handlers capture `const inner = e.target.closest(".detail-inner")` in a variable before any `innerHTML` replacement (which detaches the event target, making `closest()` return null). Combined with `data-level` attribute on `<th>`, both toggle and sort paths are correctly guarded even after DOM detachment.
- **Same-author fine-tunes**: `isBase()` treats same-author fine-tunes as base models (e.g., `Qwen/Qwen3.5-9B` is a fine-tune of `Qwen/Qwen3.5-9B-Base` but both author = "Qwen", so both appear at L2). `loadChildren()` skips same-author fine-tunes at L3 (already at L2) and labels cross-author fine-tunes as "finetune".
- **Parent param inheritance**: GGUF/AWQ/GPTQ quant models without B/M in their name (e.g. `Qwen/Qwen3-Coder-Next-GGUF`) get `paramB` from their parent via the post-deepening pass. The parent must be in the same `baseModels` array (same author) or `_allFetched`. Stripping is iterative — removes trailing `-segment` one at a time until a known parent is found.
