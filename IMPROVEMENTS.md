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

## Fixed (Items 5 & 8) — branch `fix/child-detection-false-positives`

Implemented the four-point plan from the original Medium section. All changes in
`loadChildren` (`streamlined-hf-model-search.html:1157`).

### 5. Search API false-positive children

**Root cause**: `nameMatches = idLower.includes(modelName.toLowerCase())` matched
prefix collisions (e.g. `Qwen2.5-7B-Coder-FP8` contains `Qwen2.5-7B`).

**Fix**: Replaced `includes()` with `strictNameMatch` — iteratively strips known
trailing quant suffixes (`-gguf`, `-awq`, `-fp8`, ...) from the candidate's name
portion, then checks equality against `modelName`. Cross-author orphan quants
(e.g. `SomeAuthor/Qwen2.5-7B-GGUF`) still match because only the name part is
compared. Prefix collisions with extra segments (e.g. `Qwen2.5-7B-Coder-FP8`)
correctly fail.

Also added two extra guards for inferred children (`!hasBaseModel`):
- **Pipeline-tag filter** (plan item 4): skip if `m.pipeline_tag` exists and is
  not in `activeTaskFilters`.
- **`_allFetched` de-dup** (plan item 2): skip if model is already known as a
  base model in `_allFetched`.

### 8. Same-author guard loophole

**Root cause**: `if (!isQuant && childAuthor === parentAuthor) continue` let
same-author fine-tunes with quant keywords in the name pass through.

**Fix**: Replaced the two conditional same-author guard lines with a single
unconditional `if (childAuthor === parentAuthor) continue;` before the entry
`if (hasBaseModel || ...)`. Same-author models are always visible at L2, so
they never belong at L3 regardless of quant keywords.

### Code diff summary

```
- const nameMatches = idLower.includes(modelName.toLowerCase());
- if (hasBaseModel || (nameMatches && isQuant)) {
-     ...
-     if (hasBaseModel && childAuthor === parentAuthor && !isQuant) continue;
-     if (!hasBaseModel && !isQuant && childAuthor === parentAuthor) continue;

+ const childAuthor = m.id.split("/")[0];
+ const parentAuthor = parentId.split("/")[0];
+ if (childAuthor === parentAuthor) continue;
+
+ if (hasBaseModel || (strictNameMatch(m.id) && isQuant)) {
+     if (!hasBaseModel) {
+       if (m.pipeline_tag && !activeTaskFilters.has(m.pipeline_tag)) continue;
+       if (_allFetched && _allFetched.some(f => f.id === m.id)) continue;
+     }
```

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
