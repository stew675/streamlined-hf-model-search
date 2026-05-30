# Changelog — Streamlined HF Model Search

### v260530.09 — Initial Release

Single-file, zero-dependency HuggingFace model explorer with 4-level expandable hierarchy (Author → Base Model → Quant Author → Quant). Key capabilities: progressive rendering during fetch and param deepening, queue-based API rate limiting (4 req/s), LRU-cached author/child data, piecewise-linear param slider, hidden-models preview popups with sortable columns, generation-guarded async to prevent stale renders, and batched param resolution with parent inheritance.
