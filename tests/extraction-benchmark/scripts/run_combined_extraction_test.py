#!/usr/bin/env python3
"""
Combined extraction + questions test.

Compares:
1. Extraction only (baseline from previous tests)
2. Extraction + questions in single call

Measures: detection, IoU, speed
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.gemini_client import GeminiClient, GeminiConfig
from core.image_processor import resize_for_gemini, pdf_page_to_image
from configs.prompts.extraction_with_questions import build_extraction_with_questions_prompt
from configs.prompts.full_rails import build_full_rails_prompt
from configs.prompts.high_agency import build_high_agency_prompt
from evaluation.scorer import score_extraction


# Top 3 configs by IoU with >90% detection
CONFIGS_TO_TEST = [
    {
        "name": "flash_minimal_full_rails",
        "model": "gemini-3-flash-preview",
        "thinking_level": "minimal",
        "prompt_builder": build_full_rails_prompt,
        "baseline_iou": 69.4,
        "baseline_detection": 94.1,
    },
    {
        "name": "flash_low_full_rails",
        "model": "gemini-3-flash-preview",
        "thinking_level": "low",
        "prompt_builder": build_full_rails_prompt,
        "baseline_iou": 66.8,
        "baseline_detection": 94.1,
    },
    {
        "name": "flash_medium_high_agency",
        "model": "gemini-3-flash-preview",
        "thinking_level": "medium",
        "prompt_builder": build_high_agency_prompt,
        "baseline_iou": 60.9,
        "baseline_detection": 100.0,
    },
]


def load_benchmark() -> list[dict]:
    """Load ground truth benchmark."""
    with open("benchmark/prep_questionnaire_page1.json") as f:
        data = json.load(f)
    return data["fields"]


def run_extraction_only(config: dict, image_base64: str) -> dict:
    """Run extraction-only call (baseline)."""
    client = GeminiClient(GeminiConfig(
        model=config["model"],
        thinking_level=config["thinking_level"],
    ))

    prompt = config["prompt_builder"]()

    start_time = time.perf_counter()
    result = client.extract_fields(image_base64, prompt)
    duration_ms = (time.perf_counter() - start_time) * 1000

    return {
        "fields": result.fields,
        "duration_ms": duration_ms,
    }


def run_extraction_with_questions(config: dict, image_base64: str) -> dict:
    """Run combined extraction + questions call."""
    client = GeminiClient(GeminiConfig(
        model=config["model"],
        thinking_level=config["thinking_level"],
    ))

    prompt = build_extraction_with_questions_prompt()

    start_time = time.perf_counter()
    result = client.extract_fields(image_base64, prompt)
    duration_ms = (time.perf_counter() - start_time) * 1000

    # Check if questions were generated
    questions_generated = sum(1 for f in result.fields if f.get("question"))

    return {
        "fields": result.fields,
        "duration_ms": duration_ms,
        "questions_generated": questions_generated,
    }


def main():
    print("=" * 70)
    print("COMBINED EXTRACTION + QUESTIONS TEST")
    print("=" * 70)
    print()
    print("Comparing single-call extraction+questions vs extraction-only")
    print()

    # Load data
    benchmark = load_benchmark()
    print(f"Benchmark: {len(benchmark)} fields")

    # Load and resize page image
    pdf_path = "/Users/allisterhercus/Documents/Labs/smart-form/docs/tests/Prep Questionnaire 2025.pdf"
    page_image = pdf_page_to_image(pdf_path, page_number=0)
    processed = resize_for_gemini(page_image)
    image_base64 = processed.image_base64
    print(f"Image: {processed.width}x{processed.height}")
    print()

    results = []

    for config in CONFIGS_TO_TEST:
        print(f"Testing: {config['name']}")
        print("-" * 50)

        # Run extraction only
        print("  Running extraction-only...")
        extract_result = run_extraction_only(config, image_base64)
        extract_scores = score_extraction(extract_result["fields"], benchmark)

        print(f"    Fields: {len(extract_result['fields'])}")
        print(f"    Time: {extract_result['duration_ms']:.0f}ms")
        print(f"    Detection: {extract_scores.detection_rate:.1f}%")
        print(f"    IoU: {extract_scores.avg_iou:.1f}%")

        # Run extraction + questions
        print("  Running extraction+questions...")
        combined_result = run_extraction_with_questions(config, image_base64)
        combined_scores = score_extraction(combined_result["fields"], benchmark)

        print(f"    Fields: {len(combined_result['fields'])}")
        print(f"    Questions: {combined_result['questions_generated']}")
        print(f"    Time: {combined_result['duration_ms']:.0f}ms")
        print(f"    Detection: {combined_scores.detection_rate:.1f}%")
        print(f"    IoU: {combined_scores.avg_iou:.1f}%")

        # Calculate deltas
        time_delta = combined_result["duration_ms"] - extract_result["duration_ms"]
        iou_delta = combined_scores.avg_iou - extract_scores.avg_iou
        detection_delta = combined_scores.detection_rate - extract_scores.detection_rate

        print(f"  Delta:")
        print(f"    Time: {time_delta:+.0f}ms ({time_delta/extract_result['duration_ms']*100:+.1f}%)")
        print(f"    IoU: {iou_delta:+.1f}%")
        print(f"    Detection: {detection_delta:+.1f}%")
        print()

        results.append({
            "config": config["name"],
            "model": config["model"],
            "thinking_level": config["thinking_level"],
            "extraction_only": {
                "fields": len(extract_result["fields"]),
                "duration_ms": extract_result["duration_ms"],
                "detection": extract_scores.detection_rate,
                "iou": extract_scores.avg_iou,
                "types": extract_scores.type_accuracy,
            },
            "extraction_with_questions": {
                "fields": len(combined_result["fields"]),
                "questions": combined_result["questions_generated"],
                "duration_ms": combined_result["duration_ms"],
                "detection": combined_scores.detection_rate,
                "iou": combined_scores.avg_iou,
                "types": combined_scores.type_accuracy,
            },
            "delta": {
                "time_ms": time_delta,
                "time_pct": time_delta / extract_result["duration_ms"] * 100,
                "iou": iou_delta,
                "detection": detection_delta,
            },
        })

    # Save results
    output_dir = Path("results/combined_extraction")
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(output_dir / "results.json", "w") as f:
        json.dump(results, f, indent=2)

    # Print summary
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print()
    print(f"{'Config':<30} {'Extract IoU':>12} {'Combined IoU':>12} {'Δ IoU':>8} {'Δ Time':>10}")
    print("-" * 75)

    for r in results:
        print(f"{r['config']:<30} "
              f"{r['extraction_only']['iou']:>11.1f}% "
              f"{r['extraction_with_questions']['iou']:>11.1f}% "
              f"{r['delta']['iou']:>+7.1f}% "
              f"{r['delta']['time_ms']:>+9.0f}ms")

    print()
    print(f"Results saved to: {output_dir}/results.json")

    # Show sample questions from best result
    best = max(results, key=lambda x: x["extraction_with_questions"]["iou"])
    print()
    print(f"Sample questions from {best['config']}:")

    # Re-run to get the fields with questions (or load from saved result)
    sample_config = next(c for c in CONFIGS_TO_TEST if c["name"] == best["config"])
    sample_result = run_extraction_with_questions(sample_config, image_base64)

    for field in sample_result["fields"][:5]:
        if field.get("question"):
            print(f"  • {field['label']}: \"{field['question']}\"")


if __name__ == "__main__":
    main()
