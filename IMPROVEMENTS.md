# Code Review: Remaining Items

## Fixed (Items 1–4)

These four bugs have been fixed and verified:

| # | Issue | Fix |
|---|-------|-----|
| 1 | Button stuck disabled on error | Wrapped async IIFE in try/catch, moved button restore to finally block |
| 2 | `_injectedBaseIds` race | Added generation guard before all `_injectedBaseIds.add()` and `all.push()` calls |
| 3 | `loadAuthorModels` stale renders | Capture `_fetchGeneration` at entry, skip all renders if generation changed |
| 4 | `loadChildren` races on rapid click | Deduplicate concurrent fetch for same key via a global inflight map; second caller reuses the same promise |

---

## Fixed (Item 7)

`_allFetched` is now trimmed to `ALL_FETCHED_MAX` (16,384) entries by `lastModified` descending
after each fetch cycle. The oldest models are dropped, keeping the most relevant models
for the active filters.

---

## Intentional

### 6. `reseedActiveTaskFilters` silently resets user's tag selections

Lines 848–857: changing From/To filters calls `reseedActiveTaskFilters`, which
removes any tag no longer in the resolved set and re-adds `DEFAULT_ACTIVE_TAGS`
regardless of the user's prior selection. If the user deactivated "text-generation"
and then changes a From/To filter, text-generation is re-enabled.

**Intentional**: modality changes fundamentally alter the available pipeline tags,
so a reset is appropriate. The default set represents a sensible starting point for
the new modality combination.

---

## Medium

### 5. Search API can produce false-positive children

Lines 1165–1174: the `nameMatches && isQuant` heuristic flags any model whose
ID contains the parent's name AND a quant keyword. For example, if parent is
`Qwen/Qwen2.5-7B`, a model `Qwen/Qwen2.5-7B-Coder-FP8` (not a fine-tune of the
7B) is included because it has "fp8" in the name and "qwen2.5-7b" in the parent
name. The `hasBaseModel` check in the OR condition means either match suffices.

### 8. Search API false positive: `same-author fine-tune` guard may miss some

Lines 1173–1174 in `loadChildren` skip same-author fine-tunes at L3 but the
condition `!hasBaseModel && !isQuant && childAuthor === parentAuthor` may be
overly broad — a same-author fine-tune that happens to have a quant keyword in
its name would pass through as a false positive.

### Plan for items 5 and 8

Both items stem from the same root tension:

> We want to catch models that *are* children of a base model (fine-tunes and
> quants) even when the author failed to correctly set `cardData.base_model`.
> But we must **not** reintroduce the old problem where non-compliant authors
> flood L1 with false-positive base models.

Current heuristic in `loadChildren` (item 5):
```js
if (hasBaseModel || (nameMatches && isQuant)) { ... }
```
The `nameMatches && isQuant` branch is the risky one. It catches legitimate
orphan quants (e.g. `Qwen/Qwen2.5-7B-GGUF` has no `base_model` but name
contains "Qwen2.5-7B" and "gguf") but also catches unrelated models that
happen to share a name prefix and a quant keyword.

Item 8 is a related edge: same-author fine-tunes at L3 that happen to have a
quant keyword in the name pass through because `isQuant` is true, so the
`childAuthor === parentAuthor` skip doesn't fire.

**Proposed approach (documentation only — not yet implemented):**

1. **Tighten `nameMatches`**: instead of `idLower.includes(modelName.toLowerCase())`,
   require an exact match on the suffix after stripping quant keywords. For each
   candidate, strip known quant suffixes (`-GGUF`, `-AWQ`, `-FP8`, etc.), then check
   if the stripped ID equals `parentId`. This prevents prefix-collision false
   positives (`Qwen2.5-7B-Coder-FP8` stripped → `Qwen/Qwen2.5-7B-Coder`, which
   does **not** equal `Qwen/Qwen2.5-7B`).

2. **Validate inferred children against `_allFetched`**: before labelling a model
   as a child at L3, check whether the model's own `cardData.base_model` matches
   the parent. If it does, it's a confirmed child. If not, check whether the model
   is already present as a base model in `_allFetched` (meaning it has already
   surfaced at L1/L2). If it's already a known base model, it should **not** appear
   as a child at L3. This prevents cross-author false positives where Author B's
   fine-tune of Author A's model would incorrectly show up under Author A at L3.

3. **Fix item 8 by flipping the guard order**: in the L3 filter, first check
   `childAuthor === parentAuthor` unconditionally. If true, the model is already
   visible at L2 (same-author fine-tunes are treated as base models) so skip it
   regardless of quant keywords. Then apply the quant/finetune label logic only
   for cross-author models. This eliminates the `!isQuant` loophole.

   Current (buggy):
   ```js
   if (hasBaseModel && childAuthor === parentAuthor && !isQuant) continue;
   if (!hasBaseModel && !isQuant && childAuthor === parentAuthor) continue;
   ```
   Proposed:
   ```js
   if (childAuthor === parentAuthor) continue;  // already at L2, always skip
   ```

4. **Add a `_isFalseChild` flag on models in `_allFetched`**: when a model appears
   as a search result in `loadChildren`, also check if its `pipeline_tag` is in the
   active set. If not, it was picked up by the search but isn't relevant to the
   current filter context — skip it.

**Risk**: Approach 1 (suffix stripping) could miss legitimate children whose
name includes a quant keyword in the middle rather than as a suffix (rare but
possible). Approach 2 depends on `_allFetched` being sufficiently complete
(which the 16k cap at item 7 helps limit).

**Decision gate**: only implement if testing confirms that false positives drop
to near-zero *without* re-introducing the old problem of "non-compliant" authors
polluting L1. The current heuristic errs on the side of inclusion (better to show
a few false children than miss real ones), so tightening must be validated
against real-world data.

---

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

---

## Accessibility

### 18. L2/L3/L4 sortable headers lack `aria-sort`

The `thHtml` function conditionally sets `aria-sort` on the sorted column, but
unsorted columns should explicitly have `aria-sort="none"` to inform screen
readers that the column is sortable.

### 19. Toggle should be `<button>` not `<span>`

The `▶` toggle elements are `<span>` elements with `click` handlers. Screen
reader users navigating by `Tab` cannot reach them. They should be `<button>`
elements with `aria-expanded` toggling between `true`/`false`.

---

## Optimization Ideas

| Area | Suggestion |
|------|-----------|
| UI | **Author search/filter** for L1 table (50+ authors, no way to filter) |
| L1 table | **Virtual scrolling** for >50 authors |
| API | **Deduplicate `fetchJson` calls** — if two callers request the same URL concurrently, merge into one inflight promise |
| Cache | Prune `cache` entries by LRU when total exceeds a threshold (e.g. 50MB estimated) |
| Hardcoded limit | Show a "Limited to top 500" note for popular tasks that miss tail models |
