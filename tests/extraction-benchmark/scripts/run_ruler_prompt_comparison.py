#!/usr/bin/env python3
"""
Ruler PROMPT comparison test.

Both tests use single_page architecture (NO rulers on image).
Compares:
1. full_rails prompt (mentions rulers)
2. full_rails_no_rulers prompt (no ruler mentions)

Tests whether mentioning rulers in the prompt helps or hurts
when no rulers are actually present on the image.
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
        "name": "full_rails (mentions rulers)",
        "model": "gemini-3-flash-preview",
        "thinking_level": "minimal",
        "architecture": "single_page",
        "prompt_style": "full_rails",
        "prompt_mentions_rulers": True,
    },
    {
        "name": "full_rails_no_rulers (no ruler mentions)",
        "model": "gemini-3-flash-preview",
        "thinking_level": "minimal",
        "architecture": "single_page",
        "prompt_style": "full_rails_no_rulers",
        "prompt_mentions_rulers": False,
    },
]


def load_benchmark() -> list[dict]:
    """Load ground truth benchmark."""
    with open("benchmark/prep_questionnaire_page1.json") as f:
        data = json.load(f)
    return data["fields"]


def main():
    print("=" * 70)
    print("RULER PROMPT COMPARISON TEST")
    print("=" * 70)
    print()
    print("Both use single_page architecture (NO rulers on image)")
    print("Testing whether mentioning rulers in the prompt helps or hurts")
    print()

    benchmark = load_benchmark()
    print(f"Benchmark: {len(benchmark)} fields")
    print()

    results = []

    for config in CONFIGS:
        print(f"Testing: {config['name']}")
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
            "prompt_style": config["prompt_style"],
            "prompt_mentions_rulers": config["prompt_mentions_rulers"],
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
    print(f"{'Prompt':<40} {'Rulers in Prompt':<18} {'Det':<8} {'IoU':<8} {'Overall':<8}")
    print("-" * 82)

    for r in results:
        rulers = "Yes" if r["prompt_mentions_rulers"] else "No"
        print(f"{r['config']:<40} {rulers:<18} {r['detection']:.1f}%   {r['iou']:.1f}%   {r['overall']:.1f}%")

    # Delta
    if len(results) == 2:
        delta_det = results[1]["detection"] - results[0]["detection"]
        delta_iou = results[1]["iou"] - results[0]["iou"]
        delta_overall = results[1]["overall"] - results[0]["overall"]
        print()
        print(f"Delta (no ruler prompt - ruler prompt):")
        print(f"  Detection: {delta_det:+.1f}%")
        print(f"  IoU: {delta_iou:+.1f}%")
        print(f"  Overall: {delta_overall:+.1f}%")

    # Save results
    output_dir = Path("results/ruler_prompt_comparison")
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(output_dir / "results.json", "w") as f:
        json.dump(results, f, indent=2)

    print()
    print(f"Results saved to: {output_dir}/results.json")


if __name__ == "__main__":
    main()
