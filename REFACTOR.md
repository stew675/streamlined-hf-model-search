# REFACTOR — Tree-Based Architecture

## Goal

Replace the current flat `_allFetched` array + on-the-fly classification + injection workarounds with a single consolidated model database backing a pre-built tree. The rendering pipeline becomes a simple recursive walk of display/expanded flags per node.

---

## New Data Structures

### `_modelDb` — Unified Model Database

Replaces `_allFetched` (array) + `_allFetchedById` (Map). Single `Map<string, RawModel>`:

```
_modelDb.set(modelId, normalizedModelObject)
```

Each entry is the same shape as today's `normalizeModel()` output. Expanded metadata from individual API lookups attaches directly to these objects. Lazy-discovered children from `loadChildrenToTree()` go through the same normalization path and land here — no separate cache layer.

### TreeNode

```js
{
  level: 1 | 2 | 3 | 4,        // hierarchy level
  type: 'author' | 'basemodel' | 'quantauthor' | 'quant',
  
  id: string,                   // unique within tree (modelId or author name)
  path: string,                 // "/"-separated for fast ancestry checks
  
  parent: TreeNode | null,      // back-reference to parent node
  children: Map<string, TreeNode>, // child nodes keyed by id
  
  modelRef: RawModel | null,    // → _modelDb entry (null for L1/L3 author nodes)
  
  display: boolean,             // true = should be rendered (set by filter engine)
  expanded: boolean,            // true = user has clicked expand (persists across renders)
  
  canonical: boolean,           // true = highest-download copy; false = hidden by default
  
  aggCount: number,             // visible descendant model count
  aggDownloads: number,         // sum of visible descendant downloads
  aggLikes: number,             // sum of visible descendant likes
}
```

### `_modelTree` — Tree Root

```js
{
  root: TreeNode,               // synthetic level-0 node
  byPath: Map<string, TreeNode>,// O(1) lookup by path string
  byModelId: Map<string, TreeNode>, // modelId → L2 or L4 node (for filter engine)
}
```

---

## Two-Pass Tree Construction

### Pass 1 — Base Authors & Models

Scans `_modelDb` for all base models and creates L1/L2 nodes. Canonical dedup tracking happens during this pass: for each model name with >1 author, only the highest-download copy gets `canonical = true`. Non-canonical copies exist in the tree but start hidden (`display = false`).

### Pass 2 — Attach Derivatives (Flatten)

Scans `_modelDb` for all non-base models and attaches them to their **true** base model ancestor by following `cardData.base_model` iteratively. This naturally flattens "quant-of-a-quant" chains: if C/AWQ-GGUF → B/AWQ → A/Base, it resolves to A/Base in 2 hops.

### Incremental Rebuild (Lazy Discovery)

When `loadChildrenToTree()` discovers new models via HF API search, they're normalized and added to `_modelDb`. A targeted subtree rebuild runs under the affected base model's L2 node — full Pass 1/Pass 2 is not re-run.

---

## Filter Pipeline (Full Tree Walk)

Three phases, all in a single recursive tree walk:

| Phase | Operation | Access Pattern |
|-------|-----------|---------------|
| **Down** | Walk tree recursively, evaluate filters on model nodes, set `display` | Sequential descent; parent refs already in stack frame registers |
| **Up (return)** | Propagate parent activation + accumulate stats simultaneously | Parent refs are local variables — zero pointer chasing |

```js
function runFilterPipeline() {
  // Single recursive walk over _modelTree.root.children:
  for each L1 author node:
    evaluateAuthorNode(node)   // recursive, sets display + aggregates on return
}

function evaluateAuthorNode(authorNode):
  // Recurse into children first (depth-first)
  let count = 0, dl = 0, lk = 0;
  
  for each basemodel child of authorNode:
    result = evaluateBaseModel(child);
    count += result.count; dl += result.downloads; lk += result.likes;
  
  authorNode.aggCount = count;
  authorNode.aggDownloads = dl;
  authorNode.aggLikes = lk;
  authorNode.display = (count > 0);

function evaluateBaseModel(bmNode):
  // Evaluate this model's own filters
  bmNode.display = passesAllFilters(bmNode.modelRef);
  
  let count = bmNode.display ? 1 : 0;
  let dl = bmNode.display && bmNode.modelRef ? bmNode.modelRef.downloads : 0;
  let lk = bmNode.display && bmNode.modelRef ? bmNode.modelRef.likes : 0;
  
  // Recurse into L3/L4 children (quant authors + quants)
  for each quantAuthor child of bmNode:
    result = evaluateQuantAuthor(child);
    count += result.count; dl += result.downloads; lk += result.likes;
    if (result.count > 0 && !bmNode.display) {
      // Child is active — propagate parent activation
      bmNode.display = true;
    }
  
  return { count, downloads: dl + (bmNode.display ? bmNode.modelRef?.downloads : 0), likes: lk + (bmNode.display ? bmNode.modelRef?.likes : 0) };
```

This eliminates the `_injectedBaseIds` map entirely. If a quant passes filters, its base model (L2) and author (L1) become `display: true` automatically during the upward return — even if the base model itself fails the date filter. No separate injection pass needed.

---

## Render Pipeline Changes

### L1
Replaces `renderMain(computeAuthorData())`. Walks `_modelTree.root.children`, filters by `node.display`, sorts, renders rows using aggregated stats from tree nodes.

### L2/L3/L4
Read directly from TreeNode structures. When user expands a node:
- Check `node.expanded` flag (stored on the node itself — no external Set)
- Render visible children (`node.children.values().filter(n => n.display)`)
- Collapse just sets `node.expanded = false` — no cascade-delete logic

### Expansion State
Replaces `expandedSections` Set + `_levelState.l2/l3/l4` Maps. Each TreeNode carries its own `expanded` flag and per-node sort state. No more orphan cleanup on filter changes.

---

## What Gets Removed

| Current | Replaced By |
|---------|-------------|
| `computeAuthorData()` (L1593) | Tree walk + aggregation |
| `buildCanonicalAuthors()` (L1353) | Canonical tracking during Pass 1 |
| `_injectedBaseIds` Set | Parent propagation in filter pipeline |
| `markLocalParents()` / `injectBaseModels()` | Eliminated — tree structure handles reachability |
| `isOrphanQuant()` suppression at L1 | Orphans attached to parent in Pass 2 |
| `isNestedQuant()` suppression | Flattened by `resolveTrueBase()` in Pass 2 |
| `isCanonicalCopy()` filtering | `node.canonical` flag, hidden by default |
| `expandedSections` Set + cascade-delete | `node.expanded` on TreeNode |
| `_levelState.l2/l3/l4` Maps | Per-node state on TreeNode |
| `_filterBoundaryChanged()` / `_lastFilteredCounts` | Eliminated — filter pipeline is deterministic |
| `_schedulePostDeepenRender()` | Eliminated — param resolution updates node directly |
| `cacheSet('children-' + parentId)` | Children in `_modelDb`, tree provides access |
| `_inflightChildren` Map | Simplified dedup (still needed for concurrent API calls) |
| LRU cache (`cache`, `cacheAccess`, `cacheSet`) | Only author model fetches cached; children live in tree |

## What Stays Unchanged

- API queue manager (`_workQueue`, `_dequeueNext`) — no changes
- Generation counter / stale guards — same pattern
- Param resolution pipeline (`tryResolveModelParam`, `deepenBatch`) — operates on `_modelDb` objects
- UI layer (`UI.setStatus`, `UI.queueUpdate`) — unchanged
- Popup system, slider system, filter chips, text inputs — same event wiring

---

## Implementation Steps

### Step 1: TreeNode + Construction Functions (Standalone)
Create `TreeNode` factory function and `_modelTree` structure. Pass 1/Pass 2 construction as standalone functions that consume existing `_allFetched`. No integration with render pipeline yet — output is verified by comparing against current L1/L2 author counts.

### Step 2: Replace `computeAuthorData()`
Wire tree-based version into render pipeline. Same function signature, reads from tree internally. First functional change — if it breaks, fall back to old implementation.

### Step 3: Migrate `_allFetched` → `_modelDb`
Update all data ingestion paths (`_mergeRequestResult`, `injectBaseModels`). Keep `_allFetched` as a derived view for backward compatibility during transition.

### Step 4: Rewrite `loadChildren()` → `loadChildrenToTree()`
Discovered children go into `_modelDb` + tree instead of LRU cache. Pass 2 subtree rebuild triggers on discovery.

### Step 5: Replace Expansion State
Replace `expandedSections`, `_levelState`, cascade-delete with TreeNode flags. Simplify `refreshAllExpanded()`.

### Step 6: Filter Pipeline Implementation
Implement `evaluateFilters` → `propagateParentActivation` → `aggregateStats`. Remove `_injectedBaseIds`, `markLocalParents`, `injectBaseModels`.

### Step 7: Render Functions Consume Tree Nodes Directly
Eliminate `renderMain(computeAuthorData())` pattern. L1/L2/L3/L4 reads from tree structure + model refs.

### Step 8: Cleanup
Remove dead code, old caches, old state management. Update DESIGN.md and AGENTS.md with new architecture.

---

## Risk Areas & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tree construction slow for 16K models | Render lag after "Get Results" | Pass 1/2 are O(N) scans — should be <50ms. Profile with `performance.mark()`. |
| Lazy discovery breaks tree consistency | L3/L4 shows stale data | `integrateDiscoveredChildren()` rebuilds subtree atomically; generation guards prevent stale writes. |
| Memory overhead of tree nodes | Increased memory usage | ~50 bytes/node × 16K = ~800KB additional. Negligible vs existing model objects (~20MB). |

## Estimated Scope

- **New code:** ~600 lines (TreeNode, tree construction, filter pipeline)
- **Removed code:** ~800 lines (injection system, canonical dedup, boundary tracking, expansion state management)
- **Net reduction:** ~200 lines despite adding new systems
