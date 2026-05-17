# Streamlined Hugging Face Model Search

A browser-based, 4-level hierarchical explorer for HuggingFace base models and their quantizations — no server, no install, just open the HTML file.

## Quick Start

Open `streamlined-hf-model-search.html` in any modern browser. Select your From/To filters and click **Get Results**.

## How It Works

| Level | What You See | Sortable By |
|-------|-------------|-------------|
| **1 — Model Authors** | Organizations with base models matching all active filters | Model Author, Base Models, Total Downloads, Total Likes |
| **2 — Base Models** | Individual base models by that author | Model ID, Params, Updated, Downloads, Likes |
| **3 — Quant Authors** | Who made quantizations, grouped by author | Author, Models, Downloads |
| **4 — Quantizations** | Individual quantized models with method badges | Model ID, Quant, Downloads, Likes, Updated |

## Filter Bars

Three filter bars above the table control which pipeline tags are active:

- **From** — input modality (text, image, audio, video, any, all)
- **To** — output modality (text, speech, audio, image, video, 3d, any, all)
- **Special** — toggles like "include untagged" (models with no pipeline tag)

Active pipeline tags are displayed as blue chips. Changing filters and clicking "Get Results" fetches new models. The button label changes to "Refresh" after the first fetch.

## Dual-Range Sliders

Two sliders let you filter by **date** (0=Anytime, 1-79=YYYY/MM/DD at 14-day increments, 80=Now, live tooltips) and **parameter size** (220 positions with piecewise linear mapping across 7 zoom segments, live tooltips on drag). Changes immediately re-render L1 and all open sections (debounced at 200ms). Knobs have a configurable minimum gap with bi-directional push.

## Quantization Filter

Chip bar lets you toggle quant type categories on/off:
AWQ, FP4, FP8, Finetune, GGUF, MLX, safetensors, Others.

Quant method detection checks both model name and tags for known keywords (awq, fp4, fp8, gptq, bitsandbytes, eetq, aqlm, gguf, exl2, marlin, mlx, etc.). Fine-tunes (cross-author models derived from a base) are labeled "finetune" with a green badge.

## Features

- **Zero dependencies** — single HTML file, no build step
- **Dark theme** matching GitHub/HF styling
- **From/To modality filter bars** for pipeline tag selection
- **Special toggles** (include untagged)
- **Dual-range sliders** for date and parameter size filtering (piecewise linear scale, 14-day date increments, live tooltips, bi-directional push)
- **Column sorting** at every level (click headers)
- **Expandable rows** — click any row (not a link) to expand
- **Cached results** — re-expanding is instant; task fetches are skipped once complete
- **Param deepening** — unknown param counts fetched in batches of 5 via individual model API with loading indicator (only for visible models); quant models without B/M suffix inherit their parent's param count with zero extra API calls (e.g. `Qwen3-Coder-Next-GGUF` resolves params from `Qwen3-Coder-Next`)
- **API rate limiting** — max 10 requests per second to the HuggingFace API with automatic retry on failure (exponential backoff, up to 3 retries)
- **API call counter** — displays total requests made in the session
- **Quant badges** — color-coded by method (FP4, FP8, AWQ, GGUF, MLX, etc.)

## Data Source

Uses the public HuggingFace Hub API (`https://huggingface.co/api/models`). No API key required.

## Browser Requirements

Modern browser with ES2020+ support (Chrome 90+, Firefox 90+, Safari 14+).

## Future Ideas

- Search/filter by model name at any level
- Export results to CSV
- Bookmarkable state (URL params for filters)
- Model architecture tags in L2
- Trending / likes-per-day metrics
