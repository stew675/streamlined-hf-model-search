# AGENTS.md — Streamlined HF Model Search

## Project Overview

Single-file, zero-dependency HTML/JS app that explores HuggingFace base models in a 4-level hierarchy (Author → Base Model → Quant Author → Quant). All logic lives in `streamlined-hf-model-search.html`.

## Editing AGENTS.md

When modifying this file, write the new content to a temporary file (e.g. `AGENTS.md.new`) and only copy it back to `AGENTS.md` when all edits are done. This minimizes LLM context churn from many small sequential edits against the same file.

## DESIGN-LOG.md — Usage for Coding Agents

When making changes to the source code, read `DESIGN-LOG.md` first if your change touches any of: popup behavior, CONFIG values, queue/rate-limiting logic, generation guards, render pipeline, data flow, state management, or filtering/injection logic. It contains versioned changelog entries and architecture decisions that explain *why* things work the way they do — preventing you from "fixing" intentional design choices (e.g., rejecting `queueMicrotask` for the queue scheduler, keeping L2/L3/L4 render functions separate). When your change introduces a new design decision or resolves a code review finding, append an entry to DESIGN-LOG.md rather than adding inline comments to the source.

## Conventions

- **No external dependencies** — everything inline.
- **Indent**: 2 spaces.
- **Event delegation**: One listener per container after `innerHTML` injection (`_delegatedL2`/`_delegatedL3`/`_delegatedL4` flag); state stored in `_lXState` on the container. Toggle `<button type="button">` for native keyboard Enter/Space handling.
- **ID scheme**: `t{level}-{idx}` (toggles), `d{level}-{idx}` (detail rows), `i{level}-{idx}` (inner containers).
- **Level discrimination**: `<th>` elements carry `data-level="2|3|4"` so sort handlers reject events from nested levels even after `innerHTML` detaches the target from the DOM.
- **Generation guard**: All async functions that mutate shared state capture `const gen = _fetchGeneration` at entry and check `if (gen !== _fetchGeneration) return;` before any side-effect. The queue manager checks generation both at dequeue time and post-fetch. See DESIGN-LOG.md "Architecture Decisions" for rationale.
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
21. Progressive rendering: status line shows `Fetching models… (N/M)` as each request completes; L1 updates incrementally during fetch

## Common Pitfalls

- **Data attribute names**: `data-l3-model-idx` ≠ `data-l3-model`. Always verify matching.
- **ID collisions**: L3/L4 IDs include all parent indices (`d3-{l2}-{model}-{g}`).
- **Filter refresh**: `refreshAllExpanded` queries DOM via `expandedSections` Set — must cascade-delete descendant IDs on parent collapse to avoid re-rendering orphaned sections.
- **Cache keys**: `children-{parentId}` uses the full model ID (e.g., `Qwen/Qwen2.5-7B`). LRU capped at 500 entries.
- **Author name stripping**: L2 displays `m.id.split("/").slice(1).join("/")` to avoid repeating the author.
- **L1 sort selector**: Uses `#main-table > thead > tr > th` to avoid L2/L3 nested `<th>` triggering. Do NOT delegate to `#main-table thead`.
- **Param deepening**: Only fires for the single expanded author, in batches of 4, and only for models passing current date/param filters.
- **Search endpoint limitations**: Search API (`/api/models?search=...`) never returns `safetensors` or `config` data even with `full=true`. Individual model API does — hence deepening for models without B/M suffix.
- **Detached event target**: Capture `const inner = e.target.closest(".detail-inner")` in a variable before any `innerHTML` replacement (which detaches the target, making `closest()` return null). The `data-level` attribute on `<th>` provides a secondary guard.
