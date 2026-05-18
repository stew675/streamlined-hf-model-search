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

## Fixed (Items 9–17)

| # | Issue | Fix |
|---|-------|-----|
| 9 | `cacheGet` mutates the cache (side effect in a getter) | Renamed to `cacheAccess` to signal the mutation intent |
| 10 | Duplicate sort coercion logic | Extracted `sortCoerce(v, k)` helper; `coerce`/`subCoerce` closures removed |
| 11 | `thHtml` three identical branches | Collapsed to single `arrowOnLeft` boolean check; removed duplicate branch |
| 12 | Hardcoded colgroup widths | Added `width` to column config objects; colgroup generated dynamically via `cols.map()` |
| 13 | `isInDateRange(null) === true` | **No code change** — intentional, covers legacy models without dates |
| 14 | `_l2Delegated` / `_l3Delegated` / `_l4Delegated` | Renamed to `_delegatedL2` / `_delegatedL3` / `_delegatedL4` |
| 15 | Badge shows only first quant method | Changed to `qMethods.map()` — all matching methods displayed |
| 16 | `escapeHtml` regex with inline if-chain | Simplified to single-pass `replace()` with a `_htmlEsc` Map lookup |
| 17 | `buildCanonicalAuthors` recalculated on every call | Added `_canonicalCache` — result reused when `_allFetched` reference unchanged |

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

## Fixed (Optimization)

### 20. Deduplicate `fetchJson` calls

Added `_inflightFetches` Map (`IMPROVEMENTS.md:167`). The `fetchJson` function now checks for an existing inflight promise for the given URL before starting a new request. If found, it returns the existing promise — exactly the same pattern as `_inflightChildren` for L3/L4. The entry is cleaned up via `promise.finally()` once settled (resolve or reject).

This is a safety net: L3/L4 fetches already deduplicate via `_inflightChildren`, and L2 author fetches are cached, but any concurrent call to `fetchJson` with the same URL (e.g., individual model deepening at line 1006) will now share one HTTP request.

## Remaining Optimization Ideas

| Area | Suggestion |
|------|-----------|
| UI | **Author search/filter** for L1 table (50+ authors, no way to filter) |
| L1 table | **Virtual scrolling** for >50 authors |
