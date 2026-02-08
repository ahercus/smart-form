#!/usr/bin/env python3
"""
Rulers comparison test.

Compares:
1. single_page (no rulers) with full_rails prompt
2. single_page_with_rulers (has rulers) with full_rails prompt

Tests whether the ruler mismatch in the prompt matters.
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.field_extractor import FieldExtractor, ExtractorConfig, run_extraction_test
from evaluation.scorer import score_extraction

PDF_PATH = "/Users/allisterhercus/Documents/Labs/smart-form/docs/tests/Prep Questionnaire 2025.pdf"

CONFIGS = [
    {
        "name": "flash_minimal_single_page_full_rails",
        "model": "gemini-3-flash-preview",
        "thinking_level": "minimal",
        "architecture": "single_page",
        "prompt_style": "full_rails",
        "has_rulers_on_image": False,
        "prompt_mentions_rulers": True,
    },
    {
        "name": "flash_minimal_single_page_with_rulers_full_rails",
        "model": "gemini-3-flash-preview",
        "thinking_level": "minimal",
        "architecture": "single_page_with_rulers",
        "prompt_style": "full_rails",
        "has_rulers_on_image": True,
        "prompt_mentions_rulers": True,
    },
]


def load_benchmark() -> list[dict]:
    """Load ground truth benchmark."""
    with open("benchmark/prep_questionnaire_page1.json") as f:
        data = json.load(f)
    return data["fields"]


def main():
    print("=" * 70)
    print("RULERS COMPARISON TEST")
    print("=" * 70)
    print()
    print("Testing whether rulers on the image help or hurt extraction accuracy")
    print()

    benchmark = load_benchmark()
    print(f"Benchmark: {len(benchmark)} fields")
    print()

    results = []

    for config in CONFIGS:
        print(f"Testing: {config['name']}")
        print(f"  Rulers on image: {'Yes' if config['has_rulers_on_image'] else 'No'}")
        print(f"  Prompt mentions rulers: {'Yes' if config['prompt_mentions_rulers'] else 'No'}")
        print("-" * 50)

        extractor_config = ExtractorConfig(
            model=config["model"],
            thinking_level=config["thinking_level"],
            architecture=config["architecture"],
            prompt_style=config["prompt_style"],
        )

        start_time = time.perf_counter()
        result = run_extraction_test(PDF_PATH, extractor_config, page_number=0)
        duration_ms = (time.perf_counter() - start_time) * 1000

        scores = score_extraction(result.fields, benchmark)

        print(f"  Fields detected: {len(result.fields)}")
        print(f"  Time: {duration_ms:.0f}ms")
        print(f"  Detection: {scores.detection_rate:.1f}%")
        print(f"  IoU: {scores.avg_iou:.1f}%")
        print(f"  Overall: {scores.overall_score:.1f}%")
        print()

        results.append({
            "config": config["name"],
            "has_rulers_on_image": config["has_rulers_on_image"],
            "fields": len(result.fields),
            "duration_ms": duration_ms,
            "detection": scores.detection_rate,
            "iou": scores.avg_iou,
            "overall": scores.overall_score,
        })

    # Summary
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print()
    print(f"{'Config':<50} {'Rulers':<8} {'Det':<8} {'IoU':<8} {'Overall':<8}")
    print("-" * 82)

    for r in results:
        rulers = "Yes" if r["has_rulers_on_image"] else "No"
        print(f"{r['config']:<50} {rulers:<8} {r['detection']:.1f}%   {r['iou']:.1f}%   {r['overall']:.1f}%")

    # Delta
    if len(results) == 2:
        delta_det = results[1]["detection"] - results[0]["detection"]
        delta_iou = results[1]["iou"] - results[0]["iou"]
        delta_overall = results[1]["overall"] - results[0]["overall"]
        print()
        print(f"Delta (with rulers - without rulers):")
        print(f"  Detection: {delta_det:+.1f}%")
        print(f"  IoU: {delta_iou:+.1f}%")
        print(f"  Overall: {delta_overall:+.1f}%")

    # Save results
    output_dir = Path("results/rulers_comparison")
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(output_dir / "results.json", "w") as f:
        json.dump(results, f, indent=2)

    print()
    print(f"Results saved to: {output_dir}/results.json")


if __name__ == "__main__":
    main()
