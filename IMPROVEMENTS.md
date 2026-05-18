# Code Review: Remaining Items

## Critical

### 1. `applyFilters` error leaves button permanently disabled

At line 1453, `btn.classList.add("disabled")` is set *before* the async work. If any
`await` in the async IIFE throws (network error between gen checks, etc.), execution
jumps past all `.classList.remove("disabled")` calls. The button becomes unclickable
until page refresh.

Fix: wrap the entire async IIFE body in try/catch, or use `.finally()` to restore
button state.

### 2. Race condition: `injectBaseModels` mutates `_injectedBaseIds` after generation change

At lines 1711 / 1746–1773, `injectBaseModels` clears and re-populates the shared
global `_injectedBaseIds`. If the user clicks "Get Results" twice rapidly,
generation 2 clears the set, then generation 1's pending batch resumes and
re-adds stale IDs. These stale base models then bypass the date filter in
`modelPassesAllFilters`.

Fix: check `_fetchGeneration` before each `_injectedBaseIds.add()` call, same
pattern as the `onBatch` callback already uses.

## High

### 3. `loadAuthorModels` has no generation guard

Unlike `applyFilters` which checks `gen !== _fetchGeneration`, `loadAuthorModels`
runs to completion regardless. If user changes filters while an author is expanding,
the deepening batches will `renderL2` with stale data into the container,
overwriting correctly-filtered results.

Fix: capture generation at entry, skip all mutations + renders if stale.

### 4. `loadChildren` races on rapid expand/collapse

At lines 1123–1129, two rapid clicks launch parallel `loadChildren` calls. Both
see no cache → both fetch → both call `renderL3`. The last one wins, but API
quota is doubled.

Fix: guard with an inflight promise map keyed by `children-{parentId}`.

## Medium

### 5. Search API can produce false-positive children

Lines 1165–1174: the `nameMatches && isQuant` heuristic flags any model whose
ID contains the parent's name AND a quant keyword. For example, if parent is
`Qwen/Qwen2.5-7B`, a model `Qwen/Qwen2.5-7B-Coder-FP8` (not a fine-tune of the
7B) is included because it has "fp8" in the name and "qwen2.5-7b" in the parent
name. The `hasBaseModel` check in the OR condition means either match suffices.

### 6. `reseedActiveTaskFilters` silently resets user's tag selections

Lines 848–857: changing From/To filters calls `reseedActiveTaskFilters`, which
removes any tag no longer in the resolved set and re-adds `DEFAULT_ACTIVE_TAGS`
regardless of the user's prior selection. If the user deactivated "text-generation"
and then changes a From/To filter, text-generation is re-enabled.

### 7. `_allFetched` grows without trimming

Warning at line 1503 fires when entries exceed `ALL_FETCHED_MAX` (16,384) but no
action is taken. After fetching all 44 pipeline tags (44 × 2 sorts × 500 = up
to ~44k models), the threshold is exceeded. No deduplication across refreshes
beyond the additive `seen` set.

### 8. Search API false positive: `same-author fine-tune` guard may miss some

Lines 1173–1174 in `loadChildren` skip same-author fine-tunes at L3 but the
condition `!hasBaseModel && !isQuant && childAuthor === parentAuthor` may be
overly broad — a same-author fine-tune that happens to have a quant keyword in
its name would pass through as a false positive.

## Low

### 9. `cacheGet` mutates the cache (side effect in a "getter")

Lines 622–628: `cacheGet` deletes and re-inserts the key to implement LRU
promotion. This side effect in a getter is unexpected. Minor, but worth
documenting or renaming to `cacheAccess`.

### 10. Duplicate sort coercion logic

`sortRows` + `coerce`/`subCoerce` contains the same switch-like logic repeated
three times within the function for primary key, sub-key, and the primary-key
equality path. Could be extracted to a helper.

### 11. `thHtml` arrow-placement is unnecessarily complex

Lines 1050–1056: three ternary branches determine arrow position (left vs right)
based on CSS classes. A lookup table from column config would be clearer.

### 12. Hardcoded column widths

`renderL2`/`renderL3`/`renderL4` embed magic-number `colgroup` widths in HTML
strings. Changing one requires updating all three levels. These should be
derived from a shared column config.

### 13. `isInDateRange(null) === true`

Line 525: models without dates always pass the date filter. Intentional (covers
legacy models) but undocumented.

### 14. `_l2Delegated` / `_l3Delegated` / `_l4Delegated` use a hard-coded property name

Fragile if a container element is reused for a different level. Consider
namespacing with a prefix.

### 15. `getOrphanQuantMethod` returns all matching quant methods but L2 badge uses only `[0]`

Lines 1076–1077: only the first matching quant method is displayed via badge.
If a model ID contains multiple quant keywords (unusual but possible), secondary
methods are invisible.

### 16. `escapeHtml` doesn't handle all edge cases

Line 504: the regex-based replacement could be simpler with a `replaceAll` chain
or a Map lookup. Functionally correct for the HTML contexts used.

### 17. `buildCanonicalAuthors` recalculates on every `computeAuthorData` call

Called from `computeAuthorData`, which is called every time filters change. For
50+ authors × ~16k models this is fast, but the result is never cached across
calls even though `_allFetched` rarely changes between filter-only updates.

## Accessibility

### 18. L2/L3/L4 sortable headers lack `aria-sort`

The `thHtml` function conditionally sets `aria-sort` on the sorted column, but
unsorted columns should explicitly have `aria-sort="none"` to inform screen
readers that the column is sortable.

### 19. Toggle should be `<button>` not `<span>`

The `▶` toggle elements are `<span>` elements with `click` handlers. Screen
reader users navigating by `Tab` cannot reach them. They should be `<button>`
elements with `aria-expanded` toggling between `true`/`false`.

## Optimization Ideas

| Area | Suggestion |
|------|-----------|
| UI | **Author search/filter** for L1 table (50+ authors, no way to filter) |
| L1 table | **Virtual scrolling** for >50 authors |
| API | **Deduplicate `fetchJson` calls** — if two callers request the same URL concurrently, merge into one inflight promise |
| Cache | Prune `cache` entries by LRU when total exceeds a threshold (e.g. 50MB estimated) |
| Hardcoded limit | Show a "Limited to top 500" note for popular tasks that miss tail models |

## Agreed Fixes (Items 1–4)

The following four bugs have been fixed and verified:

| # | Issue | Fix |
|---|-------|-----|
| 1 | Button stuck disabled on error | Wrapped async IIFE in try/catch, moved button restore to finally block |
| 2 | `_injectedBaseIds` race | Added generation guard before all `_injectedBaseIds.add()` and `all.push()` calls |
| 3 | `loadAuthorModels` stale renders | Capture `_fetchGeneration` at entry, skip all renders if generation changed |
| 4 | `loadChildren` races on rapid click | Deduplicate concurrent fetch for same key via a global inflight map; second caller reuses the same promise |
