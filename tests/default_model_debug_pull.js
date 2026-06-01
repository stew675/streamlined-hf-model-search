#!/usr/bin/env node
/**
 * default_model_debug_pull.js
 *
 * Generic debug utility for investigating why a specific base model shows
 * zero or fewer L3 children than expected.
 *
 * Simulates the app's full pipeline:
 * 1. Initial data pulls (trending + per-tag downloads + per-tag recent)
 * 2. Dedicated child search (loadChildren)
 * 3. Tree upsert + filter pipeline (walkFilterL4 with default filter state)
 * 4. Render simulation (renderL3 grouping logic)
 *
 * Usage:
 *   node default_model_debug_pull.js <author/model-name> [pipeline-tag]
 *
 * Example:
 *   node default_model_debug_pull.js microsoft/Phi-4-mini-instruct text-generation
 */

const https = require('https');

// ── CLI args ──
const PARENT_ID = process.argv[2] || 'microsoft/Phi-4-mini-instruct';
const PIPELINE_TAG = process.argv[3] || 'text-generation';
const MODEL_NAME = PARENT_ID.split('/').slice(1).join('/');
const PARENT_AUTHOR = PARENT_ID.split('/')[0];

// ── App constants ──
const Q_METHODS = ['awq','gptq','bitsandbytes','eetq','aqlm','gguf','exl2','marlin','mlx','bnb','fp4','fp8','nf4','int8','int4','q8','q4'];
const _Q_PATTERN = Q_METHODS.join('|');
const RE_Q_EXISTS = new RegExp(`\\b(?:${_Q_PATTERN})\\b`, 'i');
const RE_Q_MATCH = new RegExp(`\\b(?:${_Q_PATTERN})\\b`, 'gi');
const RE_Q_STRIP = new RegExp(`-(?:${_Q_PATTERN})$`, 'i');

const CONFIG = {
  LIMIT: 500,
  TRENDING_LIMIT: 1000,
  CHILD_LIMIT: 1000,
  INIT_SLIDER_FROM: 79,
  INIT_SLIDER_TO: 80,
  DATE_SLIDER_MAX: 80,
  DAYS_PER_STEP: 14,
  INIT_PARAM_SLIDER_FROM: 100,
  INIT_PARAM_SLIDER_TO: 130,
  PARAM_SLIDER_MAX: 220,
};

// Default filter state (matches app defaults)
const activeFilters = new Set(['finetune', 'gguf', 'safetensors']);
const activeTaskFilters = new Set([
  'any-to-any', 'audio-to-audio', 'audio-text-to-text', 'automatic-speech-recognition',
  'image-text-to-text', 'image-text-to-image', 'image-text-to-video', 'image-to-image',
  'image-to-text', 'image-to-video', 'image-to-3d', 'text-generation', 'text-to-audio',
  'text-to-image', 'text-to-speech', 'text-to-video', 'text-to-3d', 'translation',
  'summarization', 'question-answering', 'fill-mask', 'token-classification',
  'sentence-similarity', 'feature-extraction', 'text-classification',
  'zero-shot-classification', 'text-ranking', 'unconditional-image-generation',
  'image-classification', 'object-detection', 'image-segmentation',
  'zero-shot-image-classification', 'zero-shot-object-detection', 'depth-estimation',
  'mask-generation', 'image-feature-extraction', 'keypoint-detection', 'image-to-video',
  'image-to-3d', 'video-classification', 'video-to-video', 'video-text-to-text',
  'visual-question-answering', 'document-question-answering',
  'visual-document-retrieval', 'image-text-to-image', 'image-text-to-video'
]);
const activeSpecialFilters = new Set();
const activeFromFilters = new Set(['text', 'image', 'any']);
const activeToFilters = new Set(['text', 'any']);

// ── API helpers ──
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── App logic reproduction ──
function hasBaseModel(cd, targetId) {
  if (!cd || !cd.base_model) return false;
  const bm = cd.base_model;
  if (typeof bm === 'string') return bm === targetId;
  if (Array.isArray(bm)) return bm.some(b => {
    const bid = typeof b === 'string' ? b : (b && b.id || '');
    return bid === targetId;
  });
  return false;
}

function strictNameMatch(candidateId, modelName) {
  let name = candidateId.split('/').slice(1).join('/');
  do {
    const m = name.match(RE_Q_STRIP);
    if (!m) break;
    name = name.slice(0, -m[0].length);
  } while (true);
  return name.toLowerCase() === modelName.toLowerCase();
}

function getOrphanQuantMethod(modelId) {
  const idLower = modelId.toLowerCase();
  const matches = idLower.match(RE_Q_MATCH);
  return matches ? [...new Set(matches)] : [];
}

function getQuantFilterString(model) {
  if (!model) return 'derivative';
  const idLower = String(model.id || '').toLowerCase();
  if (idLower.includes('fp4')) return 'fp4';
  if (idLower.includes('fp8')) return 'fp8';
  const byId = getOrphanQuantMethod(model.id || '');
  if (byId.length > 0) return byId.join(', ');
  const tags = Array.isArray(model.tags) ? model.tags : [];
  if (tags.some(t => String(t).toLowerCase() === 'safetensors')) return 'safetensors';
  return 'derivative';
}

function matchesFilter(qStr) {
  if (!qStr || qStr === 'derivative') return activeFilters.has('derivative');
  const methods = qStr.split(',').map(s => s.trim().toLowerCase());
  const categories = new Set();
  for (const m of methods) {
    if (m === 'finetune') categories.add('finetune');
    else if (m === 'safetensors') categories.add('safetensors');
    else if (Q_METHODS.includes(m)) categories.add(m);
    else categories.add('others');
  }
  return [...categories].some(c => activeFilters.has(c));
}

function matchesTaskFilter(tag) {
  if (!tag) return true;
  return activeTaskFilters.has(tag);
}

// Date slider math (UTC, matching app)
function sliderValueToDate(val) {
  if (val === 0) return new Date('2010-01-01T00:00:00Z');
  if (val === CONFIG.DATE_SLIDER_MAX) return new Date();
  const now = new Date();
  const utcStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysBack = (CONFIG.DATE_SLIDER_MAX - val) * CONFIG.DAYS_PER_STEP;
  return new Date(utcStart - daysBack * 86400000);
}

function isInDateRange(dateStr) {
  if (!dateStr) return true;
  const c = new Date(dateStr);
  return c >= sliderValueToDate(CONFIG.INIT_SLIDER_FROM) && c <= sliderValueToDate(CONFIG.INIT_SLIDER_TO);
}

// Param slider math
function paramPosToValue(pos) {
  if (pos <= 0) return 0;
  if (pos >= CONFIG.PARAM_SLIDER_MAX) return Infinity;
  if (pos <= 40) return pos * 0.025;
  if (pos <= 70) return 1 + (pos - 40) * 0.1;
  if (pos <= 100) return 4 + (pos - 70) * 0.2;
  if (pos <= 130) return 10 + (pos - 100) * 1;
  if (pos <= 160) return 40 + (pos - 130) * 2;
  if (pos <= 190) return 100 + (pos - 160) * 10;
  return 400 + (pos - 190) * 20;
}

function isInParamRange(val) {
  const from = paramPosToValue(CONFIG.INIT_PARAM_SLIDER_FROM);
  const to = paramPosToValue(CONFIG.INIT_PARAM_SLIDER_TO);
  if (val === null || val === undefined) return true;
  return val >= from && val <= to;
}

// ── processChildren (loadChildren filter logic) ──
function processChildren(models, parentId, modelName, seenSet) {
  const results = [];
  const skipped = [];
  for (const m of models) {
    if (m.id === parentId || seenSet.has(m.id)) continue;
    seenSet.add(m.id);

    const cd = m.cardData || {};
    const idLower = m.id.toLowerCase();
    const tagsStr = (m.tags || []).join(' ').toLowerCase();
    const isQuant = RE_Q_EXISTS.test(idLower) || RE_Q_EXISTS.test(tagsStr);
    const childHasBase = hasBaseModel(cd, parentId);
    const childAuthor = m.id.split('/')[0];
    if (childAuthor === PARENT_AUTHOR) continue;

    if (childHasBase || (strictNameMatch(m.id, modelName) && isQuant)) {
      const qSet = new Set();
      (idLower.match(RE_Q_MATCH) || []).forEach(x => qSet.add(x));
      (tagsStr.match(RE_Q_MATCH) || []).forEach(x => qSet.add(x));
      const qMethods = [...qSet];
      let qMethod;
      if (childHasBase) {
        qMethod = qMethods.length ? 'finetune, ' + qMethods.join(', ') : 'finetune';
      } else {
        qMethod = qMethods.length ? qMethods.join(', ') : (tagsStr.includes('safetensors') ? 'safetensors' : 'derivative');
      }
      results.push({
        id: m.id,
        author: childAuthor,
        downloads: m.downloads || 0,
        likes: m.likes || 0,
        lastModified: m.lastModified || '',
        pipeline_tag: m.pipeline_tag || '',
        q_method: qMethod,
        qMethods,
        childHasBase,
        tags: m.tags || [],
        base_model: cd.base_model
      });
    } else {
      let reason;
      if (childAuthor === PARENT_AUTHOR) reason = 'same-author';
      else if (!childHasBase && !strictNameMatch(m.id, modelName)) reason = 'no-base + name-mismatch';
      else if (!childHasBase && !isQuant) reason = 'no-base + not-quant';
      else reason = 'unknown';
      skipped.push({ id: m.id, reason, downloads: m.downloads || 0, base_model: cd.base_model });
    }
  }
  return { results, skipped };
}

// ── walkFilterL4 simulation ──
function simulateWalkFilterL4(modelRef) {
  const _filterDate = modelRef.lastModified ? isInDateRange(modelRef.lastModified) : false;
  const _filterQuant = matchesFilter(getQuantFilterString(modelRef));
  const _filterTask = matchesTaskFilter(modelRef.pipeline_tag);
  const _filterUntagged = !(!modelRef.pipeline_tag && !activeSpecialFilters.has('include untagged'));
  const display = _filterDate && _filterQuant && _filterTask && _filterUntagged;
  return {
    display,
    _filterDate,
    _filterQuant,
    _filterTask,
    _filterUntagged,
    quantStr: getQuantFilterString(modelRef)
  };
}

// ── Main ──
async function main() {
  console.log(`=== Debug: ${PARENT_ID} children ===\n`);
  console.log(`Pipeline tag: ${PIPELINE_TAG}`);
  console.log(`Default date range: ${sliderValueToDate(CONFIG.INIT_SLIDER_FROM).toISOString().slice(0,10)} to ${sliderValueToDate(CONFIG.INIT_SLIDER_TO).toISOString().slice(0,10)}`);
  console.log(`Default param range: ${paramPosToValue(CONFIG.INIT_PARAM_SLIDER_FROM)}B to ${paramPosToValue(CONFIG.INIT_PARAM_SLIDER_TO)}B`);
  console.log(`Default quant filters: ${[...activeFilters].join(', ')}`);
  console.log('');

  // 1. Initial data pulls
  console.log('[1/5] Fetching initial data pulls (simulating default Get Results)...');

  const trendingUrl = `https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=${CONFIG.TRENDING_LIMIT}&full=true&cardData=true`;
  const downloadsUrl = `https://huggingface.co/api/models?sort=downloads&direction=-1&limit=${CONFIG.LIMIT}&pipeline_tag=${PIPELINE_TAG}&full=true&cardData=true`;
  const recentUrl = `https://huggingface.co/api/models?sort=lastModified&direction=-1&limit=${CONFIG.LIMIT}&pipeline_tag=${PIPELINE_TAG}&full=true&cardData=true`;

  let trending = [], downloads = [], recent = [];
  try {
    trending = await fetchJson(trendingUrl);
    console.log(`  Trending: ${trending.length}`);
  } catch (e) { console.error('  Trending failed:', e.message); }
  await sleep(300);

  try {
    downloads = await fetchJson(downloadsUrl);
    console.log(`  ${PIPELINE_TAG} downloads: ${downloads.length}`);
  } catch (e) { console.error(`  ${PIPELINE_TAG} downloads failed:`, e.message); }
  await sleep(300);

  try {
    recent = await fetchJson(recentUrl);
    console.log(`  ${PIPELINE_TAG} recent: ${recent.length}`);
  } catch (e) { console.error(`  ${PIPELINE_TAG} recent failed:`, e.message); }

  const allInitial = [...trending, ...downloads, ...recent];
  const seenInitial = new Set();
  const uniqueInitial = allInitial.filter(m => {
    if (seenInitial.has(m.id)) return false;
    seenInitial.add(m.id);
    return true;
  });
  console.log(`\n  Total unique from initial pulls: ${uniqueInitial.length}`);

  const { results: initialChildren } = processChildren(uniqueInitial, PARENT_ID, MODEL_NAME, new Set());
  console.log(`  Children of ${PARENT_ID} in initial pulls: ${initialChildren.length}`);

  // 2. Dedicated child search
  console.log('\n[2/5] Fetching dedicated child search (loadChildren simulation)...');

  const nameSearchUrl = `https://huggingface.co/api/models?search=${encodeURIComponent(MODEL_NAME)}&sort=downloads&direction=-1&limit=${CONFIG.CHILD_LIMIT}&full=true&cardData=true`;
  let searchResults = [];
  try {
    searchResults = await fetchJson(nameSearchUrl);
    console.log(`  Search '${MODEL_NAME}' returned: ${searchResults.length}`);
  } catch (e) { console.error('  Name search failed:', e.message); }

  if (searchResults.length === 0) {
    const fullIdSearchUrl = `https://huggingface.co/api/models?search=${encodeURIComponent(PARENT_ID)}&sort=downloads&direction=-1&limit=${CONFIG.CHILD_LIMIT}&full=true&cardData=true`;
    await sleep(300);
    try {
      searchResults = await fetchJson(fullIdSearchUrl);
      console.log(`  Fallback search '${PARENT_ID}' returned: ${searchResults.length}`);
    } catch (e) { console.error('  Fallback search failed:', e.message); }
  }

  const searchSeen = new Set();
  const { results: searchChildren, skipped: searchSkipped } = processChildren(searchResults, PARENT_ID, MODEL_NAME, searchSeen);
  console.log(`\n  After processChildren: ${searchChildren.length} accepted, ${searchSkipped.length} skipped`);

  // 3. Filter pipeline simulation
  console.log('\n[3/5] Simulating walkFilterL4 on accepted children...');

  let displayCount = 0;
  let hiddenCount = 0;
  const hiddenReasons = { date: 0, quant: 0, task: 0, untagged: 0 };
  const hiddenByReason = [];

  for (const c of searchChildren) {
    const f = simulateWalkFilterL4(c);
    if (f.display) {
      displayCount++;
    } else {
      hiddenCount++;
      if (!f._filterDate) { hiddenReasons.date++; hiddenByReason.push({ ...c, reason: 'date', detail: `lastModified=${c.lastModified}` }); }
      else if (!f._filterQuant) { hiddenReasons.quant++; hiddenByReason.push({ ...c, reason: 'quant', detail: `quantStr=${f.quantStr}` }); }
      else if (!f._filterTask) { hiddenReasons.task++; hiddenByReason.push({ ...c, reason: 'task', detail: `tag=${c.pipeline_tag}` }); }
      else if (!f._filterUntagged) { hiddenReasons.untagged++; hiddenByReason.push({ ...c, reason: 'untagged', detail: `tag=${c.pipeline_tag}` }); }
    }
  }

  console.log(`  Would DISPLAY: ${displayCount}`);
  console.log(`  Would HIDE: ${hiddenCount}`);
  console.log(`    - date filter: ${hiddenReasons.date}`);
  console.log(`    - quant filter: ${hiddenReasons.quant}`);
  console.log(`    - task filter: ${hiddenReasons.task}`);
  console.log(`    - untagged filter: ${hiddenReasons.untagged}`);

  if (hiddenCount > 0) {
    console.log('\n  Top 20 hidden models by downloads:');
    hiddenByReason.sort((a, b) => b.downloads - a.downloads);
    for (const h of hiddenByReason.slice(0, 20)) {
      console.log(`    ${h.id} (${h.downloads.toLocaleString()} dl) — ${h.reason}: ${h.detail}`);
    }
  }

  // 4. Render L3 simulation
  console.log('\n[4/5] Simulating renderL3 grouping...');

  const displayedChildren = searchChildren.filter(c => simulateWalkFilterL4(c).display);
  const groups = {};
  for (const c of displayedChildren) {
    if (!groups[c.author]) {
      groups[c.author] = { author: c.author, count: 0, totalDownloads: 0, models: [] };
    }
    groups[c.author].count++;
    groups[c.author].totalDownloads += c.downloads;
    groups[c.author].models.push(c);
  }

  const groupEntries = Object.values(groups);
  console.log(`  L3 authors that would render: ${groupEntries.length}`);
  console.log(`  Total L4 models that would render: ${displayedChildren.length}`);

  if (groupEntries.length > 0) {
    groupEntries.sort((a, b) => b.totalDownloads - a.totalDownloads);
    console.log('\n  Top 20 L3 authors by downloads:');
    for (const g of groupEntries.slice(0, 20)) {
      console.log(`    ${g.author}: ${g.count} models, ${g.totalDownloads.toLocaleString()} downloads`);
    }
  }

  // 5. Summary
  console.log('\n[5/5] SUMMARY');
  console.log(`  Parent model: ${PARENT_ID}`);
  console.log(`  Initial pulls found: ${initialChildren.length} children`);
  console.log(`  Dedicated search found: ${searchChildren.length} children`);
  console.log(`  After default filters: ${displayedChildren.length} would display`);
  console.log(`  L3 authors would render: ${groupEntries.length}`);

  if (displayedChildren.length === 0 && searchChildren.length > 0) {
    console.log('\n  *** ALL children are filtered out by default filters! ***');
    console.log('      This means the L3 table would show 0 authors/models.');
    const topHidden = hiddenByReason.sort((a, b) => b.downloads - a.downloads)[0];
    if (topHidden) {
      console.log(`      Top hidden model: ${topHidden.id} (${topHidden.downloads.toLocaleString()} dl)`);
      console.log(`      Hidden because: ${topHidden.reason} (${topHidden.detail})`);
    }
  }
}

main().catch(console.error);
