# AGENTS.md — Streamlined HF Model Search

## Project Overview

Single-file, zero-dependency HTML/JS app that explores HuggingFace base models in a 4-level hierarchy (Author → Base Model → Quant Author → Quant). All logic lives in `streamlined-hf-model-search.html`.

## Editing AGENTS.md

When modifying this file, write the new content to a temporary file (e.g. `AGENTS.md.new`) and only copy it back to `AGENTS.md` when all edits are done. This minimizes LLM context churn from many small sequential edits against the same file.

## Documentation Files

Read `DESIGN.md` before making changes that touch: popup behavior, CONFIG values, queue/rate-limiting logic, generation guards, render pipeline, data flow, state management, or filtering/injection logic. It contains architecture decisions and design rationale that explain *why* things work the way they do — preventing you from "fixing" intentional design choices (e.g., rejecting `queueMicrotask` for the queue scheduler, keeping L2/L3/L4 render functions separate). When your change introduces a new design decision or resolves a code review finding, append an entry to `CHANGELOG.md` rather than adding inline comments to the source.

## Conventions

- **No external dependencies** — everything inline.
- **Indent**: 2 spaces.
- **Event delegation**: One listener per container after `innerHTML` injection (`_delegatedL2`/`_delegatedL3`/`_delegatedL4` flag); state stored in `_lXState` on the container. Toggle `<button type="button">` for native keyboard Enter/Space handling.
- **ID scheme**: `t{level}-{idx}` (toggles), `d{level}-{idx}` (detail rows), `i{level}-{idx}` (inner containers).
- **Level discrimination**: `<th>` elements carry `data-level="2|3|4"` so sort handlers reject events from nested levels even after `innerHTML` detaches the target from the DOM.
- **Generation guard**: All async functions that mutate shared state capture `const gen = _fetchGeneration` at entry and check `if (isStale(gen)) return;` before any side-effect. The queue manager checks generation both at dequeue time and post-fetch. See DESIGN.md "Architecture Decisions" for rationale.
- **CSS.escape**: Any query selector interpolating user-controlled strings (author names, model IDs) must use `CSS.escape()` to prevent broken queries or injection.
- **Two-tier rendering**: `UI` object handles progressive feedback (status bar, cell badges) via `setStatus`/`queueUpdate` — never touches table structure. `RenderCoordinator` (`RC`) handles structural renders (table rebuilds) via `requestRender`/`_doFullRender` — synchronous only, guarded by `_isRendering`. Async deepening runs in a separate `_asyncDeepenPass` pass after the sync render completes.
- **No structural renders from resolution paths**: `tryResolveModelParam`, `deepenBatch`, and the inline derive loop update state/caches only, queue progressive badge updates via `UI.queueUpdate()`, and schedule structural renders via `_schedulePostDeepenRender` only when filter boundaries are crossed.
- **`refreshAllExpanded(force, allowAsync = true)`**: New `allowAsync` parameter. When `false` (structural pass), renders L2 from cache without deepening. When `true` (user-triggered), deepens via `refreshAuthorL2Section`. The structural pass uses `false`; filter/slider/click handlers use `true` (default).

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
22. Param badge updates progressively as deepening resolves each model (no full table re-render per resolution)
23. Structural re-renders are throttled: not every `_onFetchComplete` call triggers one (every 3rd or final)
24. `_isRendering` guard prevents re-entrant structural renders (rapid filter changes coalesce)

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
- **Progressive vs Structural separation**: Never call `UI.setStatus` or `UI.queueUpdate` from inside `_doFullRender` (structural path). Never call `RT.requestRender` from inside progressive update handlers. Resolution functions (`tryResolveModelParam`, `deepenBatch`) must only update state/caches and queue progressive feedback — no direct structural renders.
- **`_filterBoundaryChanged` tracking**: `_lastFilteredCounts` Map tracks per-author filtered counts. `_schedulePostDeepenRender` uses this to decide whether a structural render is needed after param resolution. If no filter boundary was crossed, progressive badge updates are sufficient.
- **`_deepeningAuthors` guard**: Prevents concurrent `refreshAuthorL2Section` invocations for the same author. Set is added-to at entry, removed in `finally` block.
- **Generation guards**: Use `isStale(gen)` instead of inline `gen !== _fetchGeneration`. All call sites use this helper — don't introduce bare comparisons.
- **Popup wiring**: Always use `makePopupTrigger(suffix, label, makeContent)` for hidden-models popup triggers. It centralizes ID sanitization (`/` → `__`) and returns `.wire()` for post-innerHTML setup. Never construct `<button id="fp-trigger-...">` inline.
