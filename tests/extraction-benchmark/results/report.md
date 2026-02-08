# Extraction Benchmark Report

Generated: 2026-02-07T20:15:28.109044

## Summary

Total configurations tested: 24

### Top 5 Configurations

| Rank | Configuration | Overall | Detection | IoU | Types | Labels |
|------|---------------|---------|-----------|-----|-------|--------|
| 1 | flash_minimal_single_page_high_agency | 89.2% | 100.0% | 67.0% | 100.0% | 94.3% |
| 2 | flash_medium_single_page_with_rulers_high_agency | 88.5% | 100.0% | 64.5% | 100.0% | 94.3% |
| 3 | flash_medium_quadrant_4_full_rails | 85.3% | 94.1% | 59.8% | 100.0% | 96.4% |
| 4 | flash_medium_single_page_full_rails | 85.1% | 94.1% | 58.7% | 100.0% | 96.9% |
| 5 | flash_minimal_quadrant_4_high_agency | 84.7% | 76.5% | 71.3% | 100.0% | 94.9% |

## All Results

| Configuration | Overall | Detection | Precision | IoU | Types | Labels | Time |
|---------------|---------|-----------|-----------|-----|-------|--------|------|
| flash_minimal_single_page_high_agency | 89.2% | 100.0% | 100.0% | 67.0% | 100.0% | 94.3% | 24773ms |
| flash_medium_single_page_with_rulers_high_agency | 88.5% | 100.0% | 100.0% | 64.5% | 100.0% | 94.3% | 26904ms |
| flash_medium_quadrant_4_full_rails | 85.3% | 94.1% | 94.1% | 59.8% | 100.0% | 96.4% | 112466ms |
| flash_medium_single_page_full_rails | 85.1% | 94.1% | 94.1% | 58.7% | 100.0% | 96.9% | 18071ms |
| flash_minimal_quadrant_4_high_agency | 84.7% | 76.5% | 100.0% | 71.3% | 100.0% | 94.9% | 73181ms |
| flash_minimal_single_page_with_rulers_full_rails | 82.9% | 88.2% | 88.2% | 58.5% | 100.0% | 96.7% | 30431ms |
| flash_medium_single_page_high_agency | 82.9% | 88.2% | 88.2% | 58.5% | 100.0% | 96.7% | 19714ms |
| flash_medium_single_page_with_rulers_full_rails | 79.6% | 88.2% | 88.2% | 50.1% | 100.0% | 91.0% | 30154ms |
| flash_medium_single_page_medium_agency | 79.2% | 88.2% | 88.2% | 46.4% | 100.0% | 96.2% | 32649ms |
| flash_medium_single_page_with_rulers_medium_agency | 77.4% | 88.2% | 88.2% | 40.5% | 100.0% | 96.2% | 29408ms |
| flash_minimal_quadrant_4_medium_agency | 76.6% | 88.2% | 83.3% | 39.1% | 100.0% | 96.2% | 98118ms |
| flash_minimal_single_page_full_rails | 75.7% | 82.4% | 82.4% | 44.7% | 100.0% | 89.8% | 27904ms |
| flash_medium_quadrant_4_minimal | 72.8% | 82.4% | 43.8% | 45.5% | 100.0% | 94.7% | 67048ms |
| flash_medium_quadrant_4_medium_agency | 63.6% | 5.9% | 50.0% | 73.7% | 100.0% | 100.0% | 67384ms |
| flash_minimal_single_page_with_rulers_minimal | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 33699ms |
| flash_minimal_single_page_with_rulers_high_agency | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 35739ms |
| flash_minimal_quadrant_4_minimal | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 36314ms |
| flash_minimal_single_page_with_rulers_medium_agency | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 37477ms |
| flash_minimal_single_page_minimal | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 37616ms |
| flash_minimal_single_page_medium_agency | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 38980ms |
| flash_medium_single_page_minimal | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 33978ms |
| flash_medium_single_page_with_rulers_minimal | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 36251ms |
| flash_medium_quadrant_4_high_agency | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 53912ms |
| flash_minimal_quadrant_4_full_rails | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 600101ms |

## Analysis by Dimension

### By Architecture

- **single_page**: 51.5% average
- **single_page_with_rulers**: 41.1% average
- **quadrant_4**: 47.9% average

### By Prompt Style

- **minimal**: 12.1% average
- **high_agency**: 57.6% average
- **medium_agency**: 49.5% average
- **full_rails**: 68.1% average

### By Thinking Level

- **MINIMAL**: 34.1% average
- **MEDIUM**: 59.5% average

## Recommendation

**Best Configuration: flash_minimal_single_page_high_agency**

- Overall Score: 89.2%
- Detection Rate: 100.0%
- Precision: 100.0%
- Average IoU: 67.0%
- Type Accuracy: 100.0%
- Label Accuracy: 94.3%
- Extraction Time: 24773ms