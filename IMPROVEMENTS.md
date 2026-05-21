# Code Review: streamlined-hf-model-search.html (v260521.04)

## Intentional Design Decisions (Confirmed OK)

### reseedActiveTaskFilters resets user's tag selections on modality change

Changing From/To filters calls `reseedActiveTaskFilters`, which removes any tag no longer in the resolved set and re-adds `DEFAULT_ACTIVE_TAGS` regardless of the user's prior selection. If the user deactivated "text-generation" and then changes a From/To filter, text-generation is re-enabled.

**Intentional**: modality changes fundamentally alter the available pipeline tags, so a reset is appropriate. The default set represents a sensible starting point for the new modality combination.

### _paramCache never cleared across sessions

`_paramCache` (line 636) accumulates param counts and is never cleared on "Get Results". For models resolved via safetensors/gguf metadata, cached values are correct across fetches since HF doesn't change model weights silently. For models resolved via ID regex parsing, the value is deterministic from the name. Safe to leave unbounded for typical session lengths; only a concern for multi-hour sessions with hundreds of authors expanded.

### Date slider position 0 = "Anytime" label but enforces 2020-01-01 floor

`sliderValueToDate(0)` returns `new Date("2020-01-01")`, not `-Infinity`. The label says "Anytime" but models created before 2020 are excluded. This is a reasonable floor since HF was founded in 2016 and meaningful open-model hosting started ~2020, but the label is slightly misleading.

### Orphan quants shown at L2 with badge rather than suppressed from L1

`isOrphanQuant()` detects quant models whose parent exists in `_allFetched` but has no explicit `cardData.base_model`. These are suppressed from L1 grouping (`computeAuthorData` line 726) but appear at the parent author's L2 with an orphan badge. This preserves discoverability of quant variants without cluttering the top-level view.

---

## Bugs

### 1. Missing CSS.escape in loadAuthorModels query selector (line 1140)

```js
const row = document.querySelector(`.l1-row[data-author="${author}"]`);
```

If an author name contains characters special to attribute selectors (`"`, `'`, `]`, `\`, space), the selector will break or match incorrectly. All other dynamic queries in this file use `CSS.escape()` (e.g., `refreshAllExpanded` line 1582, line 1603, line 1634).

**Fix**: `` `.l1-row[data-author="${CSS.escape(author)}"]` ``

### 2. Missing CSS.escape in renderL2 data-model attribute query (line 1603)

```js
const row = document.querySelector(`tr.l2-row[data-model="${CSS.escape(modelId)}"]`);
```

This one is correct — `modelId` comes from the `expandedSections` key which stores the raw model ID, and it's properly escaped. **No bug here.** (Noted for verification.)

However, at line 1072 the attribute value set in HTML uses `escapeHtml`:
```js
data-model="${escapeHtml(m.id)}"
```

And `expandedSections` stores the raw model ID from `tr.dataset.model`. Since `dataset` returns the decoded attribute value and `escapeHtml` only escapes `&<>"'`, and model IDs on HF don't contain those characters, this works in practice. But it's technically a mismatch: if a model ID ever contained `"`, `escapeHtml("Foo\"Bar")` → `Foo&quot;Bar`, then `dataset.model` returns the decoded `Foo"Bar`, but the attribute selector `[data-model="Foo&quot;Bar"]` would need to match against the raw HTML, not the decoded value.

**Risk**: Negligible for current HF model ID conventions, but technically fragile. If robustness is desired, don't use `escapeHtml` on data attributes — use raw values (they're already safe in attribute context as long as they don't contain `"`, which model IDs don't).

### 3. _allFetched.some() O(n) lookup in loadChildren processChildren (line 1383)

```js
if (_allFetched && _allFetched.some(f => f.id === m.id)) continue;
```

This runs for every candidate child model returned by the search API. With `_allFetched` up to 16,384 entries and `CHILD_LIMIT` of 1000, this is O(1000 × 16384) = ~16M comparisons in the worst case per L2 expansion.

**Fix**: Pre-compute a `Set` of IDs from `_allFetched` during init (or lazily when first needed):
```js
const _allFetchedIds = new Set(_allFetched.map(m => m.id));
// Then: if (_allFetchedIds.has(m.id)) continue;
```

### 4. Stale render from loadChildren after "Get Results" click (minor UX)

`loadChildren` has no `_fetchGeneration` guard (by design, per the comment at line 1320). If user clicks "Get Results" while children are loading for parent A:
1. L2 row is re-rendered via `innerHTML`, disconnecting the original container
2. The inflight fetch resolves, sees `container.isConnected === false`, skips render ✓
3. New L2 row for same parent is collapsed (not expanded)
4. User must click again to see children

The results are cached in `_inflightChildren.results` and LRU cache, so re-expanding works immediately. This isn't a correctness bug — it's an expected consequence of the design choice to use `container.isConnected` instead of generation guards for this path. Documenting here for awareness.

---

## Accessibility

### 1. L2/L3/L4 sortable headers lack aria-sort="none" on unsorted columns

The `thHtml` function (line 1206-1215) conditionally sets `aria-sort` only on the sorted column:
```js
const ariaSort = isSorted ? ` aria-sort="${state.asc ? "ascending" : "descending"}"` : "";
```

Unsorted but sortable columns should have `aria-sort="none"` to inform screen readers that sorting is available. Per WAI-ARIA 1.2, all sortable `<th>` elements must carry an explicit `aria-sort` attribute.

**Fix**: Change to:
```js
const ariaSort = isSorted ? ` aria-sort="${state.asc ? "ascending" : "descending"}"` : ' aria-sort="none"';
```

### 2. Toggle should be `<button>` not `<span>` (lines 1072, 1245, 1460)

The `▶` toggle elements are `<span class="toggle">` elements activated via row click delegation. Screen reader users navigating by Tab cannot reach them independently, and the element has no semantic role indicating it's interactive.

**Fix**: Replace with `<button type="button" aria-expanded="false|true">` and handle `e.target.closest("button.toggle")` in click handlers to prevent row-toggle double-fire (or use `event.stopPropagation()` on the button). Also set `aria-expanded` on expand/collapse.

### 3. L1 rows lack role="rowgroup" context for nested detail rows

The `<tr class="detail-row">` elements are direct children of `<tbody>` but contain a single `<td colspan="N">`. This is valid HTML, but assistive tech may not associate the detail content with its parent row. Consider adding `aria-labelledby` pointing to the author toggle or model link.

---

## Performance

### 1. _allFetched.some() — see Bug #3 above (O(n) per child candidate)

### 2. pruneExpiredExpansions O(n²) nested iteration (lines 762-774)

```js
for (const key of [...expandedSections]) {
    if (!key.startsWith("a|")) continue;
    const author = key.slice(2);
    // ...
    for (const child of [...expandedSections]) {
        if (child.startsWith("m|" + author + "/") || child.startsWith("g|" + author + "/")) {
            expandedSections.delete(child);
        }
    }
}
```

For each removed author, iterates all expanded sections. With many authors and deep expansion trees, this is O(authors × total_expansions). In practice the number of simultaneously expanded sections is small (<20), so this is negligible. No fix needed currently.

### 3. String concatenation in sortRows comparison (lines 1034-1051)

`sortCoerce` creates new `Date` objects and `String` wrappers for every comparison. For large L2 tables (100+ models), this generates garbage on each sort. Consider memoizing coerced values or using native comparators:
```js
// For numeric keys, skip coercion entirely
if (typeof va === 'number' && typeof vb === 'number') { ... }
```

### 4. buildCanonicalAuthors iterates _allFetched twice (lines 557-579)

First pass builds `byName` map, second pass computes canonical authors. Could be merged into a single pass that tracks `{ name → { author, maxDownloads } }` incrementally. Minor optimization; current approach is clearer.

---

## Code Quality / Maintainability

### 1. Slider input/change handlers are dense one-liners (lines 1680-1697, 1839-1856)

```js
if (nv >= tv - 1) { to.value = String(Math.min(nv + 1, CONFIG.DATE_SLIDER_MAX)); read(); if (sliderFrom >= sliderTo - 1) { from.value = String(sliderTo - 1); read(); } } else { read(); }
```

The min-gap enforcement logic is correct but extremely hard to audit. Consider extracting into a named helper:
```js
function enforceMinGap(fromEl, toEl, minGap) { ... }
```

### 2. Inconsistent error handling in async paths

- `loadAuthorModels` (line 1094): catches errors, shows retry button ✓
- `loadChildren` (line 1323): catches errors, shows retry button ✓
- `fetchTasks` (line 1954): uses `Promise.allSettled`, logs warnings, silently skips failed tasks — no UI feedback that a specific task failed
- `applyFilters` inner async (line 1721): catches and shows error in status bar ✓

Consider showing per-task failure indicators or aggregating failures into the status message.

### 3. normalizeModel strips useful fields (line 622-635)

The normalization drops `id`, `downloads`, `likes`, dates, tags, safetensors, gguf, and `cardData.base_model` — everything else is lost. The HF API returns `sha`, `siblings`, `config`, `library_name`, `creasedAt`, `lastModified`, `private`, `tags`, etc. Some of these could be useful later (e.g., `library_name` for filtering, `sha` for change detection). Consider adding a comment listing what's intentionally dropped vs. what might be needed in the future.

### 4. Q_METHODS used for both quant detection and category mapping with potential false positives (line 381)

```js
const Q_METHODS = ["awq", "gptq", "bitsandbytes", "eetq", "aqlm", "gguf", "exl2", "marlin", "mlx", "bnb", "fp4", "fp8", "nf4", "int8", "int4", "q8", "q4"];
```

The substring `int4` would match a model name like `"My-Interstellar-4B"` (contains no `int4`, but edge cases could arise with shorter tokens). The current detection uses `.toLowerCase().includes(t)`, which is correct for known quant suffixes but could produce false positives for unusual naming patterns. In practice, HF model names are well-behaved and this hasn't been observed to cause issues.

### 5. _inflightFetches cleanup race condition (lines 467-469)

```js
promise.finally(() => {
    if (_inflightFetches.get(url) === promise) _inflightFetches.delete(url);
});
```

If a new fetch for the same URL starts before the `finally` callback runs (e.g., the old promise is still pending but a third caller triggers a new one), the identity check `_inflightFetches.get(url) === promise` prevents deleting the new entry. This is correct — it's an identity-based guard that only cleans up if this specific promise is still in the map. No bug, just noting the design for reviewers.

### 6. refreshAllExpanded L2 phase checks row.closest(".detail-inner") (line 1611)

```js
if (!row || !row.closest(".detail-inner")) continue;
```

This check is redundant — `row` was already validated as non-null on line 1603, and if it exists in the DOM it must be inside a `.detail-inner` (L2 rows are only rendered inside L2 containers). The double-check is defensive but unnecessary. More importantly, this check would skip valid rows that were reparented during a re-render — though in practice `refreshAllExpanded` queries by `data-model`, so the row found IS the current one.

---

## Security

### 1. XSS via model ID / author name in href attributes

All user-controlled strings (author names, model IDs) are passed through `escapeHtml()` before insertion into HTML templates. The `escapeHtml` function (line 597) handles `&<>"'`. This is sufficient for text content and attribute values. Links use `target="_blank" rel="noopener noreferrer"` which prevents reverse tabnabbing. **No XSS vulnerabilities identified.**

### 2. No Content Security Policy

As a single-file HTML app opened locally or from file://, CSP isn't applicable. If hosted on a web server, consider adding a `<meta http-equiv="Content-Security-Policy">` tag to restrict `connect-src` to `huggingface.co`.

---

## Optimization Ideas (from IMPROVEMENTS.md, still relevant)

| Area | Suggestion | Status |
|------|-----------|--------|
| L1 table | **Virtual scrolling** for >50 authors | Low priority — most queries yield <200 authors |
| Memory | **Clear _paramCache on "Get Results"** | Optional — safe but not strictly necessary (see Intentional #2) |
