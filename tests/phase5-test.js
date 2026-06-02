var _modelTree = {
  root: null,       // TreeNode (level-0 synthetic root)
  byPath: new Map(),// string → TreeNode (O(1) path lookup)
  byModelId: new Map(), // lowercase model ID → TreeNode (L2 or L4 node)
  authorByLower: new Map(), // lowercase author string → L1 TreeNode
  byModelName: new Map() // display name → L2 TreeNode[] (canonical dedup candidates)
};
function createTreeNode(level, type, id, modelRef) {
  return {
    level, type, id,
    parent: null,
    children: new Map(),
    modelRef: modelRef || null,
    placeholder: false,
    display: true,
    expanded: false,
    canonical: true,
    aggCount: 0,
    aggDownloads: 0,
    aggLikes: 0,
    totalChildren: 0,
    aggMaxLastModified: null,
    _childrenDeepened: false,
    _filterDate: true,
    _filterQuant: true,
    _filterTask: true,
    _filterUntagged: true
  };
}

function getModelNode(modelId) {
  return _modelTree.byModelId.get((modelId || '').toLowerCase()) || null;
}

function getModelRef(modelId) {
  var node = getModelNode(modelId);
  return node ? node.modelRef : null;
}

function hasModel(modelId) {
  var ref = getModelRef(modelId);
  return !!(ref && ref.id);
}

function forEachModelRef(cb, includePlaceholders = false) {
  var seen = new Set();
  for (var node of _modelTree.byModelId.values()) {
    var ref = node && node.modelRef;
    if (!includePlaceholders && node && node.placeholder) continue;
    if (!ref || !ref.id || seen.has(ref.id)) continue;
    seen.add(ref.id);
    cb(ref, node);
  }
}

function hasAnyModels() {
  for (var node of _modelTree.byModelId.values()) {
    if (node && node.modelRef && node.modelRef.id) return true;
  }
  return false;
}

function ensureTreeRoot() {
  if (_modelTree.root) return _modelTree.root;
  var root = createTreeNode(0, 'root', '');
  _modelTree.root = root;
  return root;
}

function ensureL1AuthorNode(author) {
  ensureTreeRoot();
  var key = (author || '').toLowerCase();
  var node = _modelTree.authorByLower.get(key);
  if (!node) {
    node = createTreeNode(1, 'author', author);
    node.parent = _modelTree.root;
    _modelTree.root.children.set(author, node);
    _modelTree.authorByLower.set(key, node);
  }
  _modelTree.byPath.set(author, node);
  return node;
}

function _mergeModelRef(existing, incoming) {
  if (!existing) return incoming;
  var preserveAttempted = !!existing._inferredAttempted;
  var preserveDeep = existing.deep_status;
  Object.assign(existing, incoming);
  if (preserveAttempted) existing._inferredAttempted = true;
  if (preserveDeep != null) existing.deep_status = preserveDeep;
  return existing;
}

function ensureL2BaseNode(baseId, modelRefOrStub) {
  var author = baseId.split('/')[0];
  var l1Node = ensureL1AuthorNode(author);
  var l2Node = getModelNode(baseId);
  if (l2Node && l2Node.level === 2) {
    if (modelRefOrStub) {
      l2Node.modelRef = _mergeModelRef(l2Node.modelRef, modelRefOrStub);
      if (l2Node.placeholder && l2Node.modelRef && l2Node.modelRef.id === baseId) {
        l2Node.placeholder = false;
        l2Node.display = true;
        l2Node.canonical = true;
      }
    }
    if (l2Node.parent !== l1Node) {
      if (l2Node.parent) l2Node.parent.children.delete(baseId);
      l1Node.children.set(baseId, l2Node);
      l2Node.parent = l1Node;
    }
    _modelTree.byPath.set(baseId, l2Node);
    _modelTree.byModelId.set(baseId.toLowerCase(), l2Node);
    return l2Node;
  }

  l2Node = createTreeNode(2, 'basemodel', baseId, modelRefOrStub || null);
  if (!modelRefOrStub) {
    l2Node.placeholder = true;
    l2Node.display = false;
    l2Node.canonical = false;
  }
  l1Node.children.set(baseId, l2Node);
  l2Node.parent = l1Node;
  _modelTree.byPath.set(baseId, l2Node);
  _modelTree.byModelId.set(baseId.toLowerCase(), l2Node);
  var name = baseId.split('/').slice(1).join('/');
  var arr = _modelTree.byModelName.get(name);
  if (arr) arr.push(l2Node); else _modelTree.byModelName.set(name, [l2Node]);
  return l2Node;
}

function ensureL3Node(l2Node, quantAuthor) {
  var l3Node = l2Node.children.get(quantAuthor);
  if (!l3Node) {
    l3Node = createTreeNode(3, 'quantauthor', quantAuthor);
    l2Node.children.set(quantAuthor, l3Node);
    l3Node.parent = l2Node;
  }
  return l3Node;
}

function recomputeCanonicalForName(modelName) {
  var candidates = (_modelTree.byModelName.get(modelName) || []).filter(
    node => node && node.level === 2 && node.modelRef && !node.placeholder
  );
  if (candidates.length <= 1) {
    for (var node of candidates) node.canonical = true;
    return;
  }
  var best = candidates[0];
  for (var node of candidates) {
    var bestDl = best.modelRef && best.modelRef.downloads ? best.modelRef.downloads : 0;
    var dl = node.modelRef && node.modelRef.downloads ? node.modelRef.downloads : 0;
    if (dl > bestDl) best = node;
  }
  for (var node of candidates) {
    node.canonical = node === best;
    if (!node.canonical) node.display = false;
  }
}

function attachOrUpdateL4Node(l3Node, modelRef) {
  var l4Node = l3Node.children.get(modelRef.id);
  if (l4Node) {
    l4Node.modelRef = _mergeModelRef(l4Node.modelRef, modelRef);
    _modelTree.byModelId.set(modelRef.id.toLowerCase(), l4Node);
    return l4Node;
  }
  l4Node = createTreeNode(4, 'quant', modelRef.id, modelRef);
  l4Node.parent = l3Node;
  l3Node.children.set(modelRef.id, l4Node);
  _modelTree.byModelId.set(modelRef.id.toLowerCase(), l4Node);
  return l4Node;
}

function upsertModelIntoTree(model) {
  if (!model || !model.id) return;
  ensureTreeRoot();

  var existingNode = getModelNode(model.id);
  var modelRef = existingNode && existingNode.modelRef ? _mergeModelRef(existingNode.modelRef, model) : model;

  if (isBase(modelRef)) {
    if (existingNode && existingNode.level === 4 && existingNode.parent) {
      existingNode.parent.children.delete(model.id);
      if (existingNode.parent.children.size === 0 && existingNode.parent.parent) {
        existingNode.parent.parent.children.delete(existingNode.parent.id);
      }
    }
    var l2Node = ensureL2BaseNode(modelRef.id, modelRef);
    l2Node.placeholder = false;
    recomputeCanonicalForName(modelRef.displayName || modelRef.id.split('/').slice(1).join('/'));
    _modelTree.byModelId.set(modelRef.id.toLowerCase(), l2Node);
    return;
  }

  var trueBase = resolveTrueBase(modelRef);
  var l2Node = getModelNode(trueBase);
  if (!l2Node || l2Node.level !== 2) {
    var paramFromName = extractParamFromId(trueBase);
    var stubRef = paramFromName !== null ?
      { id: trueBase, paramB: paramFromName, downloads: 0, likes: 0, lastModified: '' } :
      { id: trueBase, paramB: null, downloads: 0, likes: 0, lastModified: '' };
    l2Node = ensureL2BaseNode(trueBase, stubRef);
    l2Node.placeholder = true;
    l2Node.display = false;
    l2Node.canonical = false;
  }

  var quantAuthor = modelRef.id.split('/')[0];
  var l3Node = ensureL3Node(l2Node, quantAuthor);
  var l4Node = attachOrUpdateL4Node(l3Node, modelRef);

  if (existingNode && existingNode.level === 4 && existingNode.parent !== l3Node) {
    if (existingNode.parent) existingNode.parent.children.delete(modelRef.id);
    l3Node.children.set(modelRef.id, existingNode);
    existingNode.parent = l3Node;
    _modelTree.byModelId.set(modelRef.id.toLowerCase(), existingNode);
  } else {
    _modelTree.byModelId.set(modelRef.id.toLowerCase(), l4Node);
  }
}


// ── DOM Reference Cache ──
var _domCache = new Map();
function cacheDomRef(key, ref) { if (ref && ref.row.isConnected) _domCache.set(key, ref); }
function invalidateDomKey(key) { _domCache.delete(key); }
function invalidateDomPrefix(prefix) { for (var k of _domCache) if (k[0].startsWith(prefix)) _domCache.delete(k[0]); }

// ── State Reset (Clear Cache) ──
function resetAppState() {
  _fetchGeneration++;
  fetchedTasks.clear();
  fetchedUntagged = false;
  _apiTimestampHead = 0;
  _apiTimestamps.length = 0;
  _inflightChildren.clear();
  _inflightFetches.clear();
  for (var item of _workQueue) { item.reject(new Error("stale generation")); }
  _workQueue.length = 0;
  _dequeueScheduled = false;
  for (var [url, ctrl] of _inflightControllers) { ctrl.abort(); }
  _inflightControllers.clear();
  for (var [el, timer] of _popupTimers) { clearTimeout(timer); }
  _popupTimers.clear();
  _deepeningAuthors.clear();
  _fetchSeen = null;
  needsUpdate = false;
  _consecutive429s = 0;
  apiCalls = 0;
  _totalBytesReceived = 0;
  _trendingAdded = 0;
  fetchedTrending = false;
  updateRateLimitUI(false);
  RenderCoordinator._renderScheduled = false;
  RenderCoordinator._isRendering = false;
  RenderCoordinator._savedExpansions = null;
  RenderCoordinator._skipL1Sort = false;
  RenderCoordinator.expandedSections.clear();
  UI._pendingUpdates.length = 0;
  UI._flushScheduled = false;
  if (_uiRafId) { cancelAnimationFrame(_uiRafId); _uiRafId = null; }
  _modelTree.byPath.clear();
  _modelTree.byModelId.clear();
  _modelTree.authorByLower.clear();
  _modelTree.byModelName.clear();
  _modelTree.root = null;
}

// ── Slider RAF Throttling ──
var _uiRafId = null;

// ═══════════════════════════════════════════════════════════════
// SECTION 3: API & Data Fetching
// ═══════════════════════════════════════════════════════════════

// ── Queue-based API Request Manager ──
//   fetchJson → _scheduleDequeue → _dequeueNext → _dispatchFetchWithRetry
function fetchJson(url) {
  var existing = _inflightFetches.get(url);
  if (existing) return existing;

  var resolve, reject;
  var promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  _workQueue.push({ url, resolve, reject });
  _scheduleDequeue();

  _inflightFetches.set(url, promise);
  promise.finally(() => {
    if (_inflightFetches.get(url) === promise) _inflightFetches.delete(url);
  });
  return promise;
}

function _scheduleDequeue() {
  if (_dequeueScheduled) return;
  _dequeueScheduled = true;
  setTimeout(_dequeueNext, 0);
}

// Dequeues the next work item from the queue and dispatches it. Gated by in-flight count
// and time window. When in-flight is maxed, relies on completion callbacks to re-enter —
// no polling timeout needed since every path through _dispatchFetchWithRetry calls back.
function _dequeueNext() {
  if (_workQueue.length === 0) { _dequeueScheduled = false; return; }
  if (_inflightCount >= CONFIG.INFLIGHT_MAX) return; // completions will re-enter

  var now = Date.now();
  var cutoff = now - CONFIG.RATE_WINDOW;
  while (_apiTimestampHead < _apiTimestamps.length && _apiTimestamps[_apiTimestampHead] < cutoff) {
    _apiTimestampHead++;
  }
  if (_apiTimestampHead > 100) {
    _apiTimestamps.splice(0, _apiTimestampHead);
    _apiTimestampHead = 0;
  }
  var inWindowCount = _apiTimestamps.length - _apiTimestampHead;
  if (inWindowCount >= CONFIG.RATE_LIMIT) {
    var wait = _apiTimestamps[_apiTimestampHead] + CONFIG.RATE_WINDOW - now + 10;
    setTimeout(_dequeueNext, Math.max(wait, 1));
    return;
  }

  // Both gates pass — pop and dispatch.
  var item = _workQueue.shift();
  if (!item) { _dequeueScheduled = false; return; }
  _apiTimestamps.push(Date.now());
  _inflightCount++;

  _dispatchFetchWithRetry(item, _fetchGeneration, 0);
}

// Executes the HTTP fetch with retry logic. On success/failure resolves/rejects the
// work item's deferred promise and triggers next dequeue. On retriable error releases
// its in-flight slot, waits backoff delay, then re-enqueues at tail to compete fairly.
function _dispatchFetchWithRetry(item, gen, retries) {
  if (isStale(gen)) { bailQueueItem(item, () => { _inflightCount--; _dequeueNext(); }); return; }
  var controller = new AbortController();
  _inflightControllers.set(item.url, controller);
  var timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT);

  fetch(item.url, { signal: controller.signal })
    .then(async res => {
      clearTimeout(timer);
      _inflightControllers.delete(item.url);
      if (isStale(gen)) { bailQueueItem(item, () => { _inflightCount--; _dequeueNext(); }); return; }
      if (res.ok) {
        _consecutive429s = 0;
        updateRateLimitUI(false);
        var text = await res.text();
        _totalBytesReceived += text.length;
        incApiCalls(1);
        var data = JSON.parse(text);
        if (isStale(gen)) { bailQueueItem(item, () => { _inflightCount--; _dequeueNext(); }); return; }
        _inflightCount--;
        item.resolve(data);
        _dequeueNext();
      } else if ((res.status === 429 || res.status >= 500) && retries < CONFIG.MAX_RETRIES) {
        var nextRetry = retries + 1;
        var delay;
        if (res.status === 429) {
          _consecutive429s++;
          updateRateLimitUI(_consecutive429s >= 3);
          var ra = res.headers.get('Retry-After');
          delay = ra ? parseInt(ra, 10) * 1000 : Math.min(1000 * Math.pow(2, retries), 30000);
        } else {
          _consecutive429s = 0;
          updateRateLimitUI(false);
          delay = Math.min(1000 * Math.pow(2, retries), 30000);
        }
        console.warn(`API ${res.status} for ${item.url}, retry ${nextRetry}/${CONFIG.MAX_RETRIES} in ${delay}ms`);
        _inflightCount--;
        setTimeout(() => {
          _workQueue.push(item);
          _scheduleDequeue();
        }, delay);
        _dequeueNext();
      } else {
        _consecutive429s = 0;
        updateRateLimitUI(false);
        incApiCalls(1);
        _inflightCount--;
        item.reject(new Error(`HTTP ${res.status}`));
        _dequeueNext();
      }
    })
    .catch(err => {
      clearTimeout(timer);
      _inflightControllers.delete(item.url);
      if (isStale(gen)) { bailQueueItem(item, () => { _inflightCount--; _dequeueNext(); }); return; }
      if (retries < CONFIG.MAX_RETRIES) {
        var delay = Math.min(1000 * Math.pow(2, retries), 30000);
        console.warn(`Network error for ${item.url}, retry ${retries + 1}/${CONFIG.MAX_RETRIES} in ${delay}ms`);
        _inflightCount--;
        setTimeout(() => {
          _workQueue.push(item);
          _scheduleDequeue();
        }, delay);
        _dequeueNext();
      } else {
        _inflightCount--;
        item.reject(err);
        _dequeueNext();
      }
    });
}

// ── Endpoint Wrappers ──
async function fetchModels(task) {
  return fetchJson(`https://huggingface.co/api/models?sort=downloads&direction=-1&limit=${CONFIG.LIMIT}&pipeline_tag=${task}&full=true&cardData=true`);
}

async function fetchRecentModels(task) {
  return fetchJson(`https://huggingface.co/api/models?sort=lastModified&direction=-1&limit=${CONFIG.LIMIT}&pipeline_tag=${task}&full=true&cardData=true`);
}

async function fetchUntaggedModels() {
  return fetchJson(`https://huggingface.co/api/models?sort=downloads&direction=-1&limit=${CONFIG.LIMIT}&full=true&cardData=true`);
}

async function fetchTrendingModels() {
  return fetchJson(`https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=${CONFIG.TRENDING_LIMIT}&full=true&cardData=true`);
}

// ── Progressive Fetch State & Merge ──
var _fetchSeen = null;        // Set of model IDs seen this generation
var _fetchCompleted = 0;      // Number of completed requests

// Initialize shared fetch state at the start of a new "Get Results" cycle.
function _initFetchState() {
  _fetchSeen = new Set();
  forEachModelRef((m) => _fetchSeen.add(m.id));
  _fetchCompleted = 0;
}
function _mergeRequestResult(rawModels, gen, pipelineTag, filterFn) {
  if (isStale(gen)) return 0;
  var added = 0;
  for (var raw of rawModels) {
    var m = normalizeModel(raw);
    if (!m) continue;
    if (_fetchSeen.has(m.id)) continue;
    _fetchSeen.add(m.id);
    m.paramB = getParamCount(m);
    if (!m.pipeline_tag && pipelineTag) m.pipeline_tag = pipelineTag;
    if (filterFn && !filterFn(m)) continue;
    upsertModelIntoTree(m);
    added++;
  }
  return added;
}

// Called by each independent completion handler to update status and trigger render.
// RAF coalescing in requestRender() handles burst protection — no modulo gate needed.
function _onFetchComplete(gen, completed, total, savedExpansions) {
  if (isStale(gen)) return;
  UI.setStatus(`Fetching models… (${completed}/${total})`);
  recomputeAndRender(savedExpansions);
}

// ── applyFilters (Main "Get Results" Entry Point) ──
function applyFilters(force, deep) {
  if (!needsUpdate && !force) return;
  needsUpdate = false;
  var savedExpansions = new Set(RC.expandedSections);
  _fetchGeneration++;
  var gen = _fetchGeneration;
  var quickBtn = document.getElementById("get-quick-results-btn");
  var deepBtn = document.getElementById("get-deep-results-btn");
  // When deep is clicked both buttons disable (quick no longer makes sense after deep).
  // When quick is clicked only the quick button disables — deep remains active so the
  // user can upgrade to deep results without re-fetching.
  // Only strip the ready indicator from buttons that get disabled.
  quickBtn.classList.remove("ready");
  quickBtn.disabled = true;
  if (deep) { deepBtn.classList.remove("ready"); deepBtn.disabled = true; }
  var tasks = resolveTasks().filter(t => activeTaskFilters.has(t));
  var newTasks = tasks.filter(t => !fetchedTasks.has(t));
  var needUntagged = activeSpecialFilters.has("include untagged") && !fetchedUntagged;
  var reenable = () => { quickBtn.disabled = false; deepBtn.disabled = false; };

  // Fast path: no new data needed, just re-render with current filters.
  if (newTasks.length === 0 && !needUntagged && fetchedTrending && !deep) {
    reenable();
    recomputeAndRender(savedExpansions);
    return;
  }

  // Async path: fire all requests independently with progressive rendering.
  (async () => {
    document.getElementById("main-table").setAttribute("aria-busy", "true");
    try {
      _initFetchState();
      var promises = [];
      var totalRequests = 0;

      // Fetch trending first so its data is available for the earliest progressive renders.
      if (!fetchedTrending) {
        totalRequests++;
        try {
          _trendingAdded = _mergeRequestResult(await fetchTrendingModels(), gen, null, null);
          fetchedTrending = true;
        } catch (e) { console.warn("fetchTrendingModels error:", e); }
        finally { _onFetchComplete(gen, ++_fetchCompleted, totalRequests, savedExpansions); }
      }

      // Fire each task's sorts as independent requests — no pairing, no batching.
      var fireFetch = (fetchFn, tag, filterFn, onDone) => {
        totalRequests++;
        promises.push((async () => {
          try {
            _mergeRequestResult(await fetchFn(), gen, tag, filterFn);
            if (onDone) onDone();
          } catch (e) { console.warn("fetch error for", tag || "special", e); }
          finally { _onFetchComplete(gen, ++_fetchCompleted, totalRequests, savedExpansions); }
        })());
      };
      for (var tag of newTasks) {
        fireFetch(() => fetchModels(tag), tag, null, () => fetchedTasks.add(tag));
        fireFetch(() => fetchRecentModels(tag), tag, null, () => fetchedTasks.add(tag));
      }

      // Fire untagged as independent request.
      if (needUntagged) {
        fireFetch(fetchUntaggedModels, null, m => !m.pipeline_tag, () => fetchedUntagged = true);
      }

      // Wait for all requests to complete before post-processing.
      await Promise.allSettled(promises);
      if (isStale(gen)) return;

      if (deep) {
        UI.setStatus(`Resolving base models…`);
        try {
          await injectBaseModels((() => {
            var renderCounter = 0;
            return () => {
              renderCounter++;
              if (isStale(gen)) return;
              if (renderCounter % 2 !== 0) return;
              var saved = new Set(RC.expandedSections);
              recomputeAndRender(saved);
            };
          })());
        } catch (e) {
          console.warn("Base model injection error:", e);
        }
      }

      if (isStale(gen)) return;
      recomputeAndRender(savedExpansions);
      UI.setStatus("");
    } catch (e) {
      console.warn("applyFilters error:", e);
      UI.setStatus("Error: " + e.message);
    } finally {
      reenable();
      document.getElementById("main-table").setAttribute("aria-busy", "false");
    }
  })();
}

// ── Parent Injection (deep mode — fetches via queue) ──
async function injectBaseModels(onBatch) {
  var gen = _fetchGeneration;
  if (isStale(gen)) return;
  var seenAuthors = new Set();
  var seen = new Set();
  forEachModelRef((m) => {
    seenAuthors.add(m.id.split("/")[0]);
    seen.add(m.id);
  });
  var injected = [];
  var fetchQueue = new Map();

  var stale = false;
  forEachModelRef((m) => {
    if (stale) return;
    if (isStale(gen)) { stale = true; return; }
    if (!isInDateRange(m.lastModified)) return;

    var baseId = null;
    var cd = m.cardData;
    var bm = cd && cd.base_model;

    if (bm) {
      baseId = getBaseModelId(cd);
      if (!baseId) return;
    } else {
      var idLower = m.id.toLowerCase();
      if (!RE_Q_EXISTS.test(idLower)) return;
      baseId = inferParent(m.id, seen);
      if (!baseId) return;
    }

    if (!seen.has(baseId) && bm && !isBase(m)) {
      var baseAuthor = baseId.split("/")[0];
      if (!seenAuthors.has(baseAuthor)) {
        if (!fetchQueue.has(baseId)) {
          fetchQueue.set(baseId, true);
        }
      }
    }
  });
  if (stale) return;

  var baseIds = [...fetchQueue.keys()];
  var completed = 0;
  var totalRequests = baseIds.length;
  var promises = baseIds.map((baseId) => {
    return fetchJson(`https://huggingface.co/api/models/${baseId}?full=true`).then(
      (raw) => {
        if (isStale(gen)) return null;
        var full = normalizeModel(raw);
        if (!full) return null;
        full.paramB = getParamCount(full);
        injected.push(full);
        seen.add(full.id);
      },
      (err) => {
        console.warn("Failed to fetch base model", err);
      }
    ).finally(() => {
      if (isStale(gen)) return;
      completed++;
      UI.setStatus(`Resolving base models… (${completed}/${totalRequests})`);
      if (onBatch) onBatch();
    });
  });
  await Promise.all(promises);

  if (isStale(gen)) return;
  for (var m of injected) upsertModelIntoTree(m);

  UI.setStatus("");
}

// ═══════════════════════════════════════════════════════════════
// SECTION 4: Data Processing & Parameter Resolution
// ═══════════════════════════════════════════════════════════════

// ── Data Normalization ──
// Transforms raw API payloads into the canonical internal model shape.
// Intentionally drops sha, siblings, config, library_name, private, and all other API fields
// (~60% memory savings vs raw API). Callers: _mergeRequestResult, injectBaseModels,
// resolveParamFromChildren, loadAuthorModels, loadChildren.
function normalizeModel(m) {
  try {
    if (!m || typeof m !== "object" || typeof m.id !== "string" || m.id.length === 0) {
      var badId = m && m.id != null ? String(m.id) : "(missing)";
      console.warn("Skipping malformed model payload", badId);
      return null;
    }
    var displayName = m.id.split('/').slice(1).join('/');
    return {
      id: m.id,
      displayName,
      displayNameLower: displayName.toLowerCase(),
      downloads: m.downloads || 0,
      likes: m.likes || 0,
      lastModified: m.lastModified || "",
      createdAt: m.createdAt || "",
      pipeline_tag: m.pipeline_tag || "",
      tags: m.tags || [],
      safetensors: m.safetensors || null,
      gguf: m.gguf || null,
      cardData: m.cardData ? { base_model: m.cardData.base_model } : null
    };
  } catch (err) {
    var badId = m && m.id != null ? String(m.id) : "(missing)";
    console.warn("Failed to normalize model payload", badId, err);
    return null;
  }
}

// ── Tree Expansion Helpers ──
// Resolve an expansion key (a|author, m|modelId, g|modelId|author) to a tree node.
function _resolveExpandKey(key) {
  if (key.startsWith(PREFIX_AUTHOR)) {
    var author = key.slice(PREFIX_AUTHOR.length);
    return _modelTree.byPath.get(author) || null;
  }
  if (key.startsWith(PREFIX_MODEL)) {
    var modelId = key.slice(PREFIX_MODEL.length);
    return getModelNode(modelId) || null;
  }
  if (key.startsWith(PREFIX_GROUP)) {
    var rest = key.slice(PREFIX_GROUP.length);
    var pipeIdx = rest.lastIndexOf('|');
    if (pipeIdx === -1) return null;
    var modelId = rest.slice(0, pipeIdx);
    var author = rest.slice(pipeIdx + 1);
    var l2 = getModelNode(modelId);
    if (!l2) return null;
    return l2.children.get(author) || null;
  }
  return null;
}
function _clearDescendantExpanded(node) {
  for (var child of node.children.values()) {
    child.expanded = false;
    _clearDescendantExpanded(child);
  }
}
// Sync tree node.expanded flags from the expandedSections persistence Set.
function _syncExpandedFromSet() {
  for (var key of RC.expandedSections) {
    var node = _resolveExpandKey(key);
    if (node) node.expanded = true;
  }
}

// ── Model Classification ──
//   getBaseModelId / isBase / inferParent
function getBaseModelId(cd) {
  if (!cd || !cd.base_model) return null;
  var bm = cd.base_model;
  if (typeof bm === "string") return bm;
  if (Array.isArray(bm)) {
    var first = bm[0];
    return typeof first === "string" ? first : (first && first.id) || null;
  }
  return null;
}

// A model is "base" if it has no cardData.base_model, or its base_model points to the same author.
// Same-author fine-tunes appear at L2 alongside true base models, since users
// browsing an author page already see them as part of that author's lineage.
function isBase(model) {
  var cd = model.cardData;
  if (!cd) return true;
  var baseId = getBaseModelId(cd);
  if (!baseId) return true;
  var author = model.id.split("/")[0];
  if (baseId.split("/")[0] === author) return true;
  return false;
}

// Iteratively strip trailing -segments from a model ID until a known parent is found.
// Handles patterns like Qwen2.5-7B-AWQ → Qwen2.5-7B, or Qwen3-Coder-Next-GGUF → Qwen3-Coder-Next.
function inferParent(modelId, knownIds) {
  var bits = modelId.split('/');
  var name = bits[1];
  if (!name) return null;
  while (name.length > 0) {
    var dash = name.lastIndexOf('-');
    if (dash <= 0) break;
    name = name.substring(0, dash);
    var candId = bits[0] + '/' + name;
    if (knownIds.has(candId)) return candId;
  }
  return null;
}

function getOrphanQuantMethod(modelId) {
  var idLower = modelId.toLowerCase();
  var matches = idLower.match(RE_Q_MATCH);
  return matches ? [...new Set(matches)] : [];
}

function getQuantFilterString(model) {
  if (!model) return "derivative";
  var idLower = String(model.id || '').toLowerCase();
  if (idLower.includes('fp4')) return 'fp4';
  if (idLower.includes('fp8')) return 'fp8';
  var byId = getOrphanQuantMethod(model.id || "");
  if (byId.length > 0) return byId.join(', ');
  var tags = Array.isArray(model.tags) ? model.tags : [];
  if (tags.some(t => String(t).toLowerCase() === 'safetensors')) return 'safetensors';
  return 'derivative';
}

// ── Pipeline Tag Resolution ──
function resolveTasks() {
  return TO_TAGS.filter(t => {
    var fromMatch = t.from.every(f => activeFromFilters.has(f));
    var toMatch = activeToFilters.has(t.to);
    return fromMatch && toMatch;
  }).map(t => t.tag);
}
function matchesTaskFilter(pipelineTag) {
  if (!pipelineTag) return true;
  var t = TO_TAGS.find(x => x.tag === pipelineTag);
  if (!t) return false;
  var fromMatch = t.from.every(f => activeFromFilters.has(f));
  var toMatch = activeToFilters.has(t.to);
  return fromMatch && toMatch;
}

// ── Parameter Extraction ──
//   extractParamFromId → getParamCount → resolveParamFromChildren → tryResolveModelParam
// Browser compatibility: extractParamFromId uses regex lookbehind assertions,
// requiring ES2018+ engines (Safari 16.4+, Firefox 78+, Chrome 64+).
function extractParamFromId(id) {
  // Pattern 1: Strict — no letter or digit before the number.
  // Catches -7B, -22B, -125m etc. but NOT 8x7B (x blocks) nor partial 2B in 22B.
  var strictB = id.match(/(?<![a-zA-Z\d])(\d+(?:\.\d+)?)[Bb](?![a-zA-Z])/);
  if (strictB) {
    var v = parseFloat(strictB[1]);
    if (v >= 0.001 && v <= 2000) return v;
  }
  var strictM = id.match(/(?<![a-zA-Z\d])(\d+(?:\.\d+)?)[Mm](?![a-zA-Z])/);
  if (strictM) {
    var v = parseFloat(strictM[1]) / 1000;
    if (v >= 0.001 && v <= 2000) return v;
  }
  // Pattern 2: MoE — 8x7B, 8x22B (letter before the multiplier is allowed)
  var moeB = id.match(/\d+[xX](\d+(?:\.\d+)?)[bB](?![a-zA-Z])/);
  if (moeB) {
    var v = parseFloat(moeB[1]);
    if (v >= 0.001 && v <= 2000) return v;
  }
  // Pattern 3: Active-param — A14B (letter A before number)
  var actB = id.match(/(?<![a-zA-Z])[aA](\d+(?:\.\d+)?)[bB](?![a-zA-Z])/);
  if (actB) {
    var v = parseFloat(actB[1]);
    if (v >= 0.001 && v <= 2000) return v;
  }
  return null;
}
function getParamCount(m) {
  if (m.paramB !== undefined) return m.paramB;
  var result;
  if (m.safetensors && m.safetensors.total != null) result = m.safetensors.total / 1e9;
  else if (m.gguf && m.gguf.total != null) result = m.gguf.total / 1e9;
  else {
    result = extractParamFromId(m.id);
    if (result !== null) m._paramSource = 'name';
  }
  m.paramB = result;
  return result;
}
async function resolveParamFromChildren(modelId) {
  var bits = modelId.split('/');
  var modelName = bits[1];
  var lim = CONFIG.DERIVED_BATCH_SIZE;
  var nameUrl = `https://huggingface.co/api/models?search=${encodeURIComponent(modelName)}&sort=downloads&direction=-1&limit=${lim}&full=true&cardData=true`;
  var idUrl = `https://huggingface.co/api/models?search=${encodeURIComponent(modelId)}&sort=downloads&direction=-1&limit=${lim}&full=true&cardData=true`;
  var [nameRes, idRes] = await Promise.all([
    fetchJson(nameUrl).catch(() => []),
    fetchJson(idUrl).catch(() => [])
  ]);
  var seen = new Set();
  var children = [];
  for (var raw of [...nameRes, ...idRes]) {
    if (!raw || !raw.id || seen.has(raw.id)) continue;
    seen.add(raw.id);
    if (raw.id === modelId) continue;
    var cd = raw.cardData || {};
    var childHasBase = hasBaseModel(cd, modelId);
    if (!childHasBase && !strictNameMatch(raw.id, modelName)) continue;
    var normalized = normalizeModel(raw);
    if (normalized) children.push(normalized);
  }
  // Sort children by ascending modification date so the oldest (typically
  // original GGUF quants) are prioritized over newer pruned variants (REAP)
  // when DERIVED_BATCH_SIZE limits how many individual cards we fetch.
  children.sort((a, b) => (a.lastModified || "").localeCompare(b.lastModified || ""));
  // Collect params from top children and use the maximum — pruning
  // (REAP, distillation) only reduces parameter counts, never increases them.
  // Try free ID-based extraction first: most quant child names contain B/M
  // patterns (e.g. "7B", "13B") that reveal the parent's parameter count
  // without an API call. Fall back to individual model fetch only when the
  // name lacks a B/M pattern (rare for quant models).
  // Early exit: if 3 non-null results agree on the current maximum, stop.
  var runningMax = null, maxConfidence = 0, usedApi = false;
  for (var i = 0; i < Math.min(children.length, CONFIG.DERIVED_BATCH_SIZE); i++) {
    var childId = children[i].id;
    var childP = extractParamFromId(childId);
    if (childP === null) {
      usedApi = true;
      try {
        var full = await fetchJson(`https://huggingface.co/api/models/${childId}?full=true`);
        childP = (full.safetensors && full.safetensors.total != null) ? full.safetensors.total / 1e9 :
            (full.gguf && full.gguf.total != null) ? full.gguf.total / 1e9 : null;
      } catch (e) { /* skip */ }
    }
    if (childP !== null) {
      if (childP > runningMax) { runningMax = childP; maxConfidence = 1; }
      else if (childP === runningMax) { maxConfidence++; }
      if (maxConfidence >= 3) break;
    }
  }
  return { value: runningMax, usedApi };
}
/**
 * Try resolving a model's parameter count via name, parent inheritance, then child search.
 * @param {Object} m Normalized base-model ref being resolved.
 * @param {number} gen Fetch generation captured by caller for stale guards.
 * @returns {Promise<boolean>} True when a parameter value is resolved and committed.
 */
async function tryResolveModelParam(m, gen) {
  var rowEl = document.querySelector(`tr.l2-row[data-model="${CSS.escape(m.id)}"]`);
  if (rowEl) rowEl.classList.add("inferring");
  UI.setStatus(`Resolving params for ${m.displayName || m.id.split('/').slice(1).join('/')}…`);

  var resolved = null;
  var source = 'none';

  // ① FREE: Name pattern extraction (B/M suffixes)
  if ((resolved = extractParamFromId(m.id)) !== null) {
    source = 'name';
  }

  // ② FREE: Parent param inheritance (iterative suffix stripping)
  if (resolved === null) {
    var bits = m.id.split('/');
    var name = bits[1];
    while (name.length > 0) {
      var dash = name.lastIndexOf('-');
      if (dash <= 0) break;
      name = name.substring(0, dash);
      var candId = bits[0] + '/' + name;

      // Tree lookup for already-resolved parents
      var parent = getModelRef(candId);
      if (parent && parent.paramB != null) { resolved = parent.paramB; source = 'parent'; break; }
    }
  }

  // ③ EXPENSIVE: Child search API calls — ONLY if still unresolved & not attempted
  var childUsedApi = false;
  if (resolved === null && !m._inferredAttempted) {
    if (isStale(gen)) {
      if (rowEl) rowEl.classList.remove("inferring");
      return false;
    }
    var childResult = await resolveParamFromChildren(m.id);
    if (isStale(gen)) {
      if (rowEl) rowEl.classList.remove("inferring");
      return false;
    }
    resolved = childResult.value;
    childUsedApi = childResult.usedApi;
    source = 'children';
  }

  // Mark as attempted to prevent future expensive retries on re-expansion/filter changes
  m._inferredAttempted = true;

  if (rowEl) rowEl.classList.remove("inferring");

  // Commit to state only on success
  if (resolved !== null) {
    m.paramB = resolved;
    var ps = source === 'name' ? 'name' : source === 'parent' ? 'parent_inherit' : (source === 'children' && childUsedApi) ? 'child_api' : 'child_name';
    m._paramSource = ps;

    var dbEntry = getModelRef(m.id);
    if (dbEntry && dbEntry !== m) {
      dbEntry.paramB = resolved;
      dbEntry._paramSource = ps;
    }
  }

  // Progressive UI update only — no structural render
  UI.queueUpdate(() => UI.updateCellBadge(m.id, paramBadgeHtml(m)));
  return resolved !== null;
}

// ── Filter Pipeline ──
//   matchesFilter → qMethodToCategory → resolveTasks → matchesTaskFilter
function matchesFilter(qMethod) {
  if (!qMethod) return true;
  var methods = qMethod.toLowerCase().split(",").map(s => s.trim());
  return methods.some(m => {
    var cat = qMethodToCategory(m);
    return activeFilters.has(cat);
  });
}
function qMethodToCategory(method) {
  var m = method.toLowerCase();
  if (m.includes('fp4')) return 'fp4';
  if (m.includes('fp8')) return 'fp8';
  if (["awq", "finetune", "gguf", "mlx", "fp4", "fp8", "safetensors"].includes(m)) return m;
  return "others";
}
// ── Post-Deepen Tree Re-evaluation ──
function _schedulePostDeepenRender(author, gen) {
  if (isStale(gen)) return;
  var l1Node = _modelTree.byPath.get(author);
  if (!l1Node) return;
  var prevIds = new Set();
  for (var l2Node of l1Node.children.values()) {
    if (l2Node.display && l2Node.canonical) prevIds.add(l2Node.id);
  }
  walkFilterL1(l1Node);
  if (prevIds.size !== l1Node.aggCount) {
    RC.requestRender(null, true);
    return;
  }
  for (var l2Node of l1Node.children.values()) {
    if (l2Node.display && l2Node.canonical && !prevIds.has(l2Node.id)) {
      RC.requestRender(null, true);
      return;
    }
  }
}

// ── Tree Construction (Refactored Architecture) ──
//   resolveTrueBase
// Follows cardData.base_model chain iteratively to find the true base ancestor.
// Stops when chain is exhausted or the next hop is not in tree model refs.
// Max 10 hops with cycle detection via visited Set.
/**
 * Resolve the deepest known base-model ancestor for a model ID.
 * @param {string|Object} modelOrId Model ID string or normalized model object.
 * @returns {string} Resolved base model ID (or input ID when unresolved).
 */
function resolveTrueBase(modelOrId) {
  var startId = typeof modelOrId === 'string' ? modelOrId : (modelOrId && modelOrId.id) || '';
  if (!startId) return startId;
  var current = startId;
  var startBase = typeof modelOrId === 'string' ? null : getBaseModelId(modelOrId.cardData);
  var visited = new Set();
  for (var i = 0; i < 10; i++) {
    visited.add(current);
    var baseId = null;
    if (current === startId && startBase) {
      baseId = startBase;
    } else {
      var m = getModelRef(current);
      if (!m || !m.cardData) return current;
      // Stop at same-author fine-tunes / true base models — they're L2 parents.
      if (isBase(m)) return current;
      baseId = getBaseModelId(m.cardData);
    }
    if (!baseId || visited.has(baseId)) return current;
    current = baseId;
  }
  return current;
}


// ── Tree Filter Pipeline (Refactored Architecture) ──
//   passesTreeNodeFilters → passesL4Filters → runFilterPipeline
// Single recursive walk over _modelTree that evaluates filters, propagates
// parent activation (quants reactivate their base model), and aggregates stats.

// Filters an L2 (base model) node. Parent propagation in the tree walk
// handles reactivating parents whose quants pass filters.
function passesTreeNodeFilters(m) {
  var tf2 = RC._state.textFilters.l2Model;
  if (tf2 && !(m.displayNameLower || m.id.split("/").slice(1).join("/").toLowerCase()).includes(tf2.toLowerCase())) return false;
  if (!isInDateRange(m.lastModified)) return false;
  var tag = m.pipeline_tag;
  if (!tag && !activeSpecialFilters.has("include untagged")) return false;
  var pb = m.paramB != null ? m.paramB : getParamCount(m);
  if (!isInParamRange(pb)) return false;
  if (_hideMissingParamEnabled && pb === null) return false;
  if (!matchesTaskFilter(tag)) return false;
  if (tag && !activeTaskFilters.has(tag)) return false;
  var qMethods = m._orphanQuantMethods || getOrphanQuantMethod(m.id);
  if (qMethods.length > 0) {
    var matchesAny = qMethods.some(qm => activeFilters.has(qMethodToCategory(qm)));
    if (!matchesAny) return false;
  }
  return true;
}

// L4 filter decisions are decomposed and stored on each L4 TreeNode during
// walkFilterL4 (see _filterDate, _filterQuant, _filterTask, _filterUntagged).
// Render paths read node.display directly instead of re-evaluating predicates.

// Single recursive tree walk: evaluates filters, propagates parent activation,
// and accumulates stats. Sets node.display and node.agg{Count,Downloads,Likes}.
function runFilterPipeline() {
  if (!_modelTree.root) return;
  for (var l1Node of _modelTree.root.children.values()) {
    walkFilterL1(l1Node);
  }
}
function walkFilterL1(node) {
  var count = 0, dl = 0, lk = 0, totalCanonical = 0;
  for (var l2Node of node.children.values()) {
    var r = walkFilterL2(l2Node);
    if (l2Node.canonical) totalCanonical++;
    if (l2Node.display && l2Node.canonical) count++;
    dl += r.downloads; lk += r.likes;
  }
  node.aggCount = count;
  node.aggDownloads = dl;
  node.aggLikes = lk;
  node.display = count > 0;
  node.totalChildren = totalCanonical;
}
/**
 * Evaluate one L2 node, aggregate descendants, and apply parent reactivation rules.
 * @param {Object} node L2 TreeNode.
 * @returns {{count:number, downloads:number, likes:number}} Aggregated subtree stats.
 */
function walkFilterL2(node) {
  var ref = node.modelRef;
  var passes = ref ? passesTreeNodeFilters(ref) : false;
  node.display = false;
  node._reactivatedByChildren = false;
  var childCount = 0;
  var childDl = 0;
  var childLk = 0;
  for (var l3Node of node.children.values()) {
    var r = walkFilterL3(l3Node);
    childCount += r.count;
    childDl += r.downloads;
    childLk += r.likes;
  }

  var qMethods = ref ? getOrphanQuantMethod(ref.id) : [];
  node._orphanQuantMethods = qMethods;
  if (ref) ref._orphanQuantMethods = qMethods;
  var selfQuantMatch = qMethods.length > 0 && qMethods.some(qm => activeFilters.has(qMethodToCategory(qm)));
  var hasOrphanQuant = qMethods.length > 0;
  var includeSelf = passes && (!hasOrphanQuant || selfQuantMatch);

  // Parent propagation: quants reactivate their parent only when the parent's
  // own exclusion is NOT caused by param range, hide-missing-params, or L2 text filter.
  // This includes quant-chip-only exclusions at L2: a parent with matching children
  // should remain visible even when the parent ID itself has no quant match.
  if (!includeSelf && childCount > 0) {
    var tf2 = RC._state.textFilters.l2Model;
    var textFilterBlocks = tf2 && ref && !(ref.displayNameLower || ref.id.split('/').slice(1).join('/').toLowerCase()).includes(tf2.toLowerCase());
    var tag = ref ? ref.pipeline_tag : '';
    var untaggedBlocks = !tag && !activeSpecialFilters.has("include untagged");
    if (!textFilterBlocks && !untaggedBlocks) {
      var pb = ref ? (ref.paramB != null ? ref.paramB : getParamCount(ref)) : null;
      if (pb !== null ? isInParamRange(pb) : !_hideMissingParamEnabled) {
        includeSelf = true;
        node._reactivatedByChildren = true;
      }
    }
  }

  node.display = includeSelf;
  var selfDl = includeSelf && ref ? (ref.downloads || 0) : 0;
  var selfLk = includeSelf && ref ? (ref.likes || 0) : 0;
  var count = childCount + (includeSelf ? 1 : 0);
  var dl = childDl + selfDl;
  var lk = childLk + selfLk;
  node.aggCount = count;
  node.aggDownloads = dl;
  node.aggLikes = lk;
  node.totalChildren = [...node.children.values()].reduce((s, l3) => s + l3.totalChildren, 0);
  return { count, downloads: dl, likes: lk };
}
function walkFilterL3(node) {
  var count = 0, dl = 0, lk = 0, maxLM = null;
  for (var l4Node of node.children.values()) {
    var r = walkFilterL4(l4Node);
    count += r.count; dl += r.downloads; lk += r.likes;
    if (l4Node.display && l4Node.modelRef && l4Node.modelRef.lastModified) {
      if (!maxLM || l4Node.modelRef.lastModified > maxLM) maxLM = l4Node.modelRef.lastModified;
    }
  }
  node.display = count > 0;
  node.aggCount = count;
  node.aggDownloads = dl;
  node.aggLikes = lk;
  node.aggMaxLastModified = maxLM;
  node.totalChildren = node.children.size;
  return { count, downloads: dl, likes: lk };
}
function walkFilterL4(node) {
  var ref = node.modelRef;
  var qStr = ref ? getQuantFilterString(ref) : 'derivative';
  node._quantFilterString = qStr;
  node._filterDate = ref ? isInDateRange(ref.lastModified) : false;
  node._filterQuant = ref ? matchesFilter(qStr) : false;
  node._filterTask = ref ? matchesTaskFilter(ref.pipeline_tag) : false;
  node._filterUntagged = ref ? (!(!ref.pipeline_tag && !activeSpecialFilters.has("include untagged"))) : false;
  node.display = node._filterDate && node._filterQuant && node._filterTask && node._filterUntagged;
  return {
    count: node.display ? 1 : 0,
    downloads: node.display && ref ? (ref.downloads || 0) : 0,
    likes: node.display && ref ? (ref.likes || 0) : 0
  };
}



// ── Mocks for standalone test ──
var PREFIX_AUTHOR = 'a|';
var PREFIX_MODEL = 'm|';
var PREFIX_GROUP = 'g|';
var Q_METHODS = ["awq", "gptq", "bitsandbytes", "eetq", "aqlm", "gguf", "exl2", "marlin", "mlx", "bnb", "fp4", "fp8", "nf4", "int8", "int4", "q8", "q4"];
var _Q_PATTERN = Q_METHODS.join("|");
var RE_Q_EXISTS = new RegExp(`\\b(?:${_Q_PATTERN})\\b`, 'i');
var RE_Q_MATCH = new RegExp(`\\b(?:${_Q_PATTERN})\\b`, 'gi');
var RE_Q_STRIP = new RegExp(`-(?:${_Q_PATTERN})$`, 'i');

var CONFIG = {
  LIMIT: 100, AUTHOR_LIMIT: 100, CHILD_LIMIT: 100,
  DERIVED_BATCH_SIZE: 4, TRENDING_LIMIT: 20,
  RATE_LIMIT: 4, RATE_WINDOW: 1000, INFLIGHT_MAX: 6, FETCH_TIMEOUT: 15000, MAX_RETRIES: 3,
  DEBOUNCE_MS: 150, POPUP_SHOW_DELAY: 350, POPUP_HIDE_DELAY: 200,
  DATE_SLIDER_MAX: 60, DAYS_PER_STEP: 7, PARAM_MIN_GAP: 0, PARAM_SLIDER_MAX: 120, THUMB_SIZE: 20,
  INIT_SLIDER_FROM: 0, INIT_SLIDER_TO: 60,
  INIT_PARAM_SLIDER_FROM: 0, INIT_PARAM_SLIDER_TO: 120,
  POPUP_MAX_SAMPLES_L4: 50
};

var activeFromFilters = new Set(['text-generation', 'text-to-image']);
var activeToFilters = new Set(['text-generation', 'text-to-image']);
var activeTaskFilters = new Set(['text-generation', 'text-to-image']);
var activeSpecialFilters = new Set();
var activeFilters = new Set();
var _hideMissingParamEnabled = false;

var TO_TAGS = [
  { tag: 'text-generation', from: ['text-generation'], to: 'text-generation' },
  { tag: 'text-to-image', from: ['text-to-image'], to: 'text-to-image' }
];

function resolveTasks() {
  return TO_TAGS.filter(function(t) {
    var fromMatch = t.from.every(function(f) { return activeFromFilters.has(f); });
    var toMatch = activeToFilters.has(t.to);
    return fromMatch && toMatch;
  }).map(function(t) { return t.tag; });
}

matchesTaskFilter = function(t) { return true; };
matchesFilter = function(qMethod) { return true; };
isInDateRange = function(dateStr) { return true; };
isInParamRange = function(paramB) { return true; };

var RC = {
  _state: {
    l1Sort: { key: "totalDownloads", asc: false },
    detailSort: {},
    expandedSections: new Set(),
    textFilters: { l1Author: "", l2Model: "", l3Author: "", l4Model: "" }
  }
};

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
}

// ── Test 1: L2/L4 promotion eviction ──
ensureTreeRoot();
var l1 = ensureL1AuthorNode('Qwen');

// First ingest as L4 quant under a different base model
var baseL2 = ensureL2BaseNode('meta-llama/Llama-3-8B', {
  id: 'meta-llama/Llama-3-8B', downloads: 100, likes: 10,
  lastModified: '2024-01-15T00:00:00Z', pipeline_tag: 'text-generation',
  paramB: 8, tags: []
});
var l3 = ensureL3Node(baseL2, 'Qwen');
var l4 = attachOrUpdateL4Node(l3, {
  id: 'Qwen/Qwen2.5-7B', downloads: 50, likes: 5,
  lastModified: '2024-02-15T00:00:00Z', pipeline_tag: 'text-generation',
  paramB: 7, tags: [], cardData: { base_model: 'meta-llama/Llama-3-8B' }
});

assert(getModelNode('Qwen/Qwen2.5-7B').level === 4, 'Should start as L4');

// Now ingest the same model as a base model (same-author fine-tune, no base_model)
upsertModelIntoTree(normalizeModel({
  id: 'Qwen/Qwen2.5-7B', downloads: 200, likes: 20,
  lastModified: '2024-03-15T00:00:00Z', pipeline_tag: 'text-generation',
  paramB: 7, tags: []
}));

var promotedNode = getModelNode('Qwen/Qwen2.5-7B');
assert(promotedNode.level === 2, 'After promotion should be L2: ' + promotedNode.level);
assert(promotedNode.parent === l1, 'L2 should be under Qwen L1');
assert(!l3.children.has('Qwen/Qwen2.5-7B'), 'Old L4 should be evicted from L3 parent');

console.log('PASS: L2/L4 promotion eviction');

// ── Test 2: Filter pipeline basic ──
ensureTreeRoot();
var l1b = ensureL1AuthorNode('Test');

var l2a = ensureL2BaseNode('Test/ModelA', {
  id: 'Test/ModelA', downloads: 100, likes: 10,
  lastModified: '2024-01-15T00:00:00Z', pipeline_tag: 'text-generation',
  paramB: 8, tags: []
});
var l2b = ensureL2BaseNode('Test/ModelB', {
  id: 'Test/ModelB', downloads: 200, likes: 20,
  lastModified: '2024-01-15T00:00:00Z', pipeline_tag: 'text-generation',
  paramB: 8, tags: []
});

runFilterPipeline();

assert(l2a.display === true, 'ModelA should be displayed');
assert(l2b.display === true, 'ModelB should be displayed');
assert(l1b.display === true, 'Test author should be displayed');

console.log('PASS: Filter pipeline basic');

// ── Test 3: recomputeCanonicalForName with byModelName index ──
ensureTreeRoot();
var l1c1 = ensureL1AuthorNode('OrgA');
var l1c2 = ensureL1AuthorNode('OrgB');
var l2c1 = ensureL2BaseNode('OrgA/Model-X', {
  id: 'OrgA/Model-X', downloads: 100, likes: 10,
  lastModified: '2024-01-15T00:00:00Z', pipeline_tag: 'text-generation',
  paramB: 8, tags: []
});
var l2c2 = ensureL2BaseNode('OrgB/Model-X', {
  id: 'OrgB/Model-X', downloads: 200, likes: 20,
  lastModified: '2024-01-15T00:00:00Z', pipeline_tag: 'text-generation',
  paramB: 8, tags: []
});

recomputeCanonicalForName('Model-X');
assert(l2c1.canonical === false, 'Lower-download variant should not be canonical');
assert(l2c2.canonical === true, 'Higher-download variant should be canonical');
assert(l2c1.display === false, 'Non-canonical should be hidden');
assert(l2c2.display === true, 'Canonical should be visible');

console.log('PASS: Canonical dedup with byModelName index');

// ── Test 4: byModelId case-insensitive lookup ──
ensureTreeRoot();
var l1d = ensureL1AuthorNode('Test');
var l2d = ensureL2BaseNode('Test/Case-Model', {
  id: 'Test/Case-Model', downloads: 100, likes: 10,
  lastModified: '2024-01-15T00:00:00Z', pipeline_tag: 'text-generation',
  paramB: 8, tags: []
});

var found = _modelTree.byModelId.get('test/case-model');
assert(found === l2d, 'byModelId should find L2 node with different case via lowercase key');

console.log('PASS: byModelId case-insensitive lookup');

// ── Test 5: displayName precomputation ──
var nm = normalizeModel({ id: 'Qwen/Qwen2.5-7B', downloads: 100, likes: 10 });
assert(nm.displayName === 'Qwen2.5-7B', 'displayName should be model ID without author');
assert(nm.displayNameLower === 'qwen2.5-7b', 'displayNameLower should be lowercase');

console.log('PASS: displayName precomputation');

console.log('All tests passed!');
