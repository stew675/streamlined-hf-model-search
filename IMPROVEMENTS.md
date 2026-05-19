# Code Review: Remaining Items

## Intentional

### reseedActiveTaskFilters resets user's tag selections

Changing From/To filters calls `reseedActiveTaskFilters`, which removes any tag no longer in the resolved set and re-adds `DEFAULT_ACTIVE_TAGS` regardless of the user's prior selection. If the user deactivated "text-generation" and then changes a From/To filter, text-generation is re-enabled.

**Intentional**: modality changes fundamentally alter the available pipeline tags, so a reset is appropriate. The default set represents a sensible starting point for the new modality combination.

## Accessibility

### 1. L2/L3/L4 sortable headers lack `aria-sort`

The `thHtml` function conditionally sets `aria-sort` on the sorted column, but unsorted columns should explicitly have `aria-sort="none"` to inform screen readers that the column is sortable.

### 2. Toggle should be `<button>` not `<span>`

The `▶` toggle elements are `<span>` elements with `click` handlers. Screen reader users navigating by `Tab` cannot reach them. They should be `<button>` elements with `aria-expanded` toggling between `true`/`false`.

## Optimization Ideas

| Area | Suggestion |
|------|-----------|
| UI | **Author search/filter** for L1 table (50+ authors, no way to filter) |
| L1 table | **Virtual scrolling** for >50 authors |
