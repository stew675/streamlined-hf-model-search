# A Streamlined Hugging Face Model Search

A dark-color themed, browser-based, 4-level hierarchical explorer for HuggingFace base models and their quantizations.

**Key Features:**
- No server. No install steps. Just open the `streamlined-hf-model-search.html` file in your browser.
- Uses the public HuggingFace Hub API (`https://huggingface.co/api/models`).
- No API key required.
- All API calls are rate-limited to be gentle on the Hugging Face server.


## Example Output

![Hugging Face Search](./search.png "Example Search")


## Feature specifics

### Tiered Output Structure

Select your search criteria and click **Get Quick Results** or **Get Deep Results**.  A four tier model navigation tree is presented:

**Get Quick Results** — fetches top models per pipeline tag; skips cross-author base model injection for speed. **Get Deep Results** — same as Quick, plus resolves cross-author base models referenced by quantizations via individual API calls. Slower but surfaces more quantizations.

| Level | Role | What You See | Sortable By |
|-------|------|-------|-------------|
| **1** | **Base Model Authors** | Organizations with base models matching all active filters | Model Author, Base Models, Total Downloads, Total Likes |
| **2** | **Base Author Models** | Individual base models by that author | Model ID, Params, Updated, Downloads, Likes |
| **3** | **Derivative Authors** | Who made derivative models, grouped by author | Author, Models, Downloads |
| **4** | **Derivative Models** | Derivative quantized/finetuned models with method badges | Model ID, Quant, Downloads, Likes, Updated |


### Dual-Range Sliders

Two sliders let you filter by **date** and **parameter size**.  Live tool-tips show what has been selected.

Selection knobs have a minimum gap with bi-directional pushing.

**Date:**
- Left Most Position = *Anytime*
- Middle Positions are in 14-day increments prior to *Now*
- Right-most position = *Now*

**Parameter size:**
- Select from 0B to >1T parameters via piecewise linear mapping across 7 zoom segments.


### Filter Bars

Three *Type* filter bars control which pipeline tags are active.
**From**, **To**, and **Special** are used to quickly activate broad categories of pipeline tags.
The user may then selectively activate/deactivate individual tags to refine their choices.

It should be noted that *Any* refers to the specific modality with the name *any* and is not intended to activate all modalities.
The *All* activation chip is used for quickly activating all modalities.

- **From:** input modality (text, image, audio, video, any, all)
- **To:** output modality (text, speech, audio, image, video, 3d, any, all)
- **Special:** toggles like "include untagged" (models with no pipeline tag)


### Quantization Filter Selection

The **Quant Types** chip bar lets you toggle popular quant type categories on/off:
- AWQ
- Finetune
- FP4
- FP8 
- GGUF
- MLX
- Safe Tensors
- Others - whatever doesn't match the above

Quant method detection checks both model name and tags for known keywords (awq, fp4, fp8, gguf, mlx, etc.).
Fine-tunes (cross-author models derived from a base) are labeled "finetune" with a green badge.
All detected quant methods are displayed when a model ID contains multiple keywords.

### Output Display Filters

Above the displayed results are 4 text boxes which may be used to selectively filter the output.

The *L1 Author* box will move all Base Model Authors that match the text to the top of the displayed hierarchical tree.

The other text filters control which models and derivative authors will be displayed at the L2, L3, and L4 expansion levels.

### Additional Result Table Features

- **Column sorting** - Available at every level by clicking the column headers
- **Expandable rows** - Click on any row (excluding the link) to expand 
- **Cached results** - Re-expanding is instant; task fetches are skipped once complete; stale-generation renders are discarded
- **Parameter deepening** - Models with unknown parameter counts are fetched when rows are opened and results are updated in real time (if available)
- **Infer Missing Parameters chip** — When enabled (default), models with unknown params search their children to deduce the parent's parameter count via API
- **Hide Missing Parameters chip** — When enabled, models without a known parameter count are hidden from L1 and L2 entirely
- **API call counter** — displays total requests made in the session; hover for rate-limit info; flashes amber during active rate limiting (3+ consecutive 429s)
- **Clear Cache button** — empties all in-memory caches (param cache, LRU model cache, inflight state, inference tracking) while preserving filters, sliders, and expanded sections
- **Quant badges** — color-coded by method (FP4, FP8, AWQ, GGUF, MLX, etc.); all detected methods shown; orphan quants get a yellow badge

## Caveats

By necessity of being kind to the Hugging Face API end-point, not all author and model results are exhaustively complete.

Unfortunately many authors don't tag their model metadata properly.
In order to expose such authors would require hammering the HuggingFace API quite heavily which is bad practise.

As a result, if you know the name of a specific author/model that you're looking for, then just use the regular Hugging Face Search Page and look them up there.

While the utility has extremely generous limits for the number of authors it will pull, for very obscure authors with no real visibility or active use, then these may be left out of the search results.  Again, if you're looking for something extremely obscure or specific, use the main HuggingFace Search Page.

## Browser Requirements

Modern browser with ES2020+ support (Chrome 90+, Firefox 90+, Safari 14+).


## Future Ideas

- Export results to CSV
- Bookmarkable state (URL params for filters)
- Model architecture tags in L2
- Trending / likes-per-day metrics
