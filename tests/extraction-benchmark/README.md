# Extraction Benchmark Framework

Python testing framework for evaluating Gemini model + thinking level + prompt style + architecture combinations for PDF field extraction.

## Overview

This framework systematically tests different configurations to find the optimal extraction approach:

- **Models**: gemini-3-flash-preview (MINIMAL, MEDIUM thinking)
- **Architectures**: single_page, single_page_with_rulers, quadrant_4
- **Prompts**: minimal, high_agency, medium_agency, full_rails

**Total: 24 test configurations** (1 model × 2 thinking × 3 architectures × 4 prompts)

## Setup

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows

# Install dependencies
pip install -r requirements.txt

# For SVG overlay support (optional but recommended)
pip install cairosvg

# Set API key
export GEMINI_API_KEY="your-api-key"
```

## Usage

### Run Full Benchmark

```bash
python orchestrator.py
```

### Run with Options

```bash
# Limit to 5 tests (for quick debugging)
python orchestrator.py --max-tests 5

# Skip visualization generation
python orchestrator.py --no-visualize

# Custom PDF and benchmark
python orchestrator.py --pdf path/to/doc.pdf --benchmark path/to/benchmark.json
```

### Visualize Benchmark

```bash
python tools/visualize_benchmark.py \
    docs/tests/Prep_Questionnaire_2025.pdf \
    benchmark/prep_questionnaire_page1.json \
    benchmark/visualizations/page1.png
```

## Project Structure

```
extraction-benchmark/
├── benchmark/
│   ├── prep_questionnaire_page1.json  # Ground truth
│   └── visualizations/                # Rendered benchmarks
├── configs/
│   └── prompts/
│       ├── minimal.py         # ~15 lines, basic types
│       ├── high_agency.py     # ~25 lines, trust the model
│       ├── medium_agency.py   # ~130 lines, production prompt
│       └── full_rails.py      # ~250 lines, exhaustive rules
├── core/
│   ├── image_processor.py     # PDF→image, overlay creation
│   ├── gemini_client.py       # API wrapper
│   ├── field_extractor.py     # Single/quadrant extraction
│   └── deduplicator.py        # Boundary deduplication
├── evaluation/
│   └── scorer.py              # IoU, matching, scoring
├── tools/
│   └── visualize_benchmark.py # Render fields on page
├── results/
│   ├── raw/                   # JSON extraction results
│   ├── visualizations/        # PNG overlays per config
│   ├── scores/                # Aggregated scores
│   └── report.md              # Comparison report
├── orchestrator.py            # Main entry point
└── requirements.txt
```

## Scoring Metrics

All metrics are percentages (0-100%):

| Metric | Weight | Description |
|--------|--------|-------------|
| Detection Rate | 25% | % of ground truth fields found (recall) |
| Precision | 10% | % of predictions that are valid |
| Average IoU | 30% | Coordinate accuracy (Intersection over Union) |
| Type Accuracy | 20% | Correct field type selection |
| Label Accuracy | 15% | Fuzzy label matching |

## Benchmark Format

```json
{
  "document": "prep_questionnaire_2025_page1",
  "page": 1,
  "field_count": 17,
  "fields": [
    {
      "label": "Child's Name",
      "fieldType": "text",
      "coordinates": {"left": 18.97, "top": 24.5, "width": 30.71, "height": 2.0},
      "groupLabel": "Student Information"
    },
    {
      "label": "D.O.B",
      "fieldType": "linkedDate",
      "coordinates": {"left": 56.38, "top": 24.5, "width": 26.12, "height": 2.0},
      "dateSegments": [
        {"left": 56.38, "top": 24.5, "width": 6.06, "height": 2.0, "part": "day"},
        {"left": 63.59, "top": 24.5, "width": 5.88, "height": 2.0, "part": "month"},
        {"left": 70.83, "top": 24.5, "width": 11.67, "height": 2.0, "part": "year"}
      ],
      "groupLabel": "Student Information"
    }
  ]
}
```

## Special Field Types

- **linkedDate**: Segmented date with day/month/year boxes
- **table**: Structured grid with tableConfig
- **textarea**: Multi-line text with rows property
- **linkedText**: Non-rectangular flowing text (rare)

## Output

After running, check `results/report.md` for:
- Top 5 configurations ranked by overall score
- Full results table
- Analysis by architecture, prompt style, thinking level
- Recommended configuration

## Coordinate Snapping Benchmarks

Separate from the Python extraction benchmarks, a TypeScript benchmark suite tests the coordinate snapping pipeline that corrects Gemini's field coordinates against deterministic geometry sources.

These scripts import production code directly from `src/lib/coordinate-snapping/` — they test the actual pipeline, not copies.

### Scripts

| Script | Purpose |
|--------|---------|
| `test_full_pipeline.ts` | End-to-end: Gemini extraction → snapping → scoring against ground truth |
| `test_combined.ts` | Tests all snap stage ordering permutations to find optimal chain |
| `test_cv_snap.ts` | Isolates CV (pixel-level) line detection accuracy |
| `test_ocr_snap.ts` | Isolates OCR-based label alignment accuracy |
| `test_pdf_vectors.ts` | Isolates PDF vector geometry extraction accuracy |
| `test_acroform.ts` | Tests AcroForm field matching for PDFs with embedded form definitions |
| `render_production.ts` | Generates visual overlays (green = ground truth, blue = production) |
| `test_utils.ts` | Shared IoU scoring and field matching utilities |

### Pipeline Results

| Stage | IoU |
|-------|-----|
| Gemini only (baseline) | 67.8% |
| + Coordinate snapping | 79.1% |
| **Improvement** | **+11.3%, zero regressions** |
