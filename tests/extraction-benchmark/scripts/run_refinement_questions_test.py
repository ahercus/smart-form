#!/usr/bin/env python3
"""
Two-pass extraction test:
1. Initial extraction (best configs)
2. Refinement + questions pass

Tests whether a second pass can improve field coordinates
while also generating questions.
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.field_extractor import ExtractorConfig, run_extraction_test
from core.gemini_client import GeminiClient, GeminiConfig
from core.image_processor import resize_for_gemini, pdf_page_to_image
from configs.prompts.refinement_with_questions import build_refinement_with_questions_prompt
from evaluation.scorer import score_extraction

PDF_PATH = "/Users/allisterhercus/Documents/Labs/smart-form/docs/tests/Prep Questionnaire 2025.pdf"

# Top 3 IoU configs with >90% detection (2 have 100%, 1 has 94.1%)
CONFIGS_TO_TEST = [
    {
        "name": "flash_minimal_single_page_high_agency",
        "model": "gemini-3-flash-preview",
        "thinking_level": "minimal",
        "architecture": "single_page",
        "prompt_style": "high_agency",
        "baseline_iou": 67.0,
        "baseline_detection": 100.0,
    },
    {
        "name": "flash_medium_single_page_high_agency",
        "model": "gemini-3-flash-preview",
        "thinking_level": "medium",
        "architecture": "single_page",
        "prompt_style": "high_agency",
        "baseline_iou": 60.9,  # from original tests
        "baseline_detection": 100.0,
    },
    {
        "name": "flash_medium_single_page_full_rails",
        "model": "gemini-3-flash-preview",
        "thinking_level": "medium",
        "architecture": "single_page",
        "prompt_style": "full_rails_no_rulers",  # Use the no-rulers version
        "baseline_iou": 58.7,
        "baseline_detection": 94.1,
    },
]


def load_benchmark() -> list[dict]:
    """Load ground truth benchmark."""
    with open("benchmark/prep_questionnaire_page1.json") as f:
        data = json.load(f)
    return data["fields"]


def run_refinement_pass(initial_fields: list[dict], image_base64: str, thinking_level: str = "medium") -> dict:
    """
    Run refinement + questions pass on extracted fields.

    Args:
        initial_fields: Fields from first extraction pass
        image_base64: The form image
        thinking_level: Thinking level for refinement (default medium for reasoning)

    Returns:
        Dict with refined fields, timing, and question count
    """
    client = GeminiClient(GeminiConfig(
        model="gemini-3-flash-preview",
        thinking_level=thinking_level,
    ))

    prompt = build_refinement_with_questions_prompt(initial_fields)

    start_time = time.perf_counter()
    result = client.extract_fields(image_base64, prompt)
    duration_ms = (time.perf_counter() - start_time) * 1000

    # Count questions generated
    questions_generated = sum(1 for f in result.fields if f.get("question"))

    return {
        "fields": result.fields,
        "duration_ms": duration_ms,
        "questions_generated": questions_generated,
    }


def main():
    print("=" * 70)
    print("TWO-PASS EXTRACTION TEST: REFINEMENT + QUESTIONS")
    print("=" * 70)
    print()
    print("Pass 1: Initial extraction (various configs)")
    print("Pass 2: Refinement + question generation")
    print()

    # Load data
    benchmark = load_benchmark()
    print(f"Benchmark: {len(benchmark)} fields")
    print()

    # Prepare image for refinement pass
    page_image = pdf_page_to_image(PDF_PATH, page_number=0)
    processed = resize_for_gemini(page_image)
    image_base64 = processed.image_base64

    results = []

    for config in CONFIGS_TO_TEST:
        print(f"Testing: {config['name']}")
        print("=" * 60)

        # Pass 1: Initial extraction
        print("  PASS 1: Initial extraction...")
        extractor_config = ExtractorConfig(
            model=config["model"],
            thinking_level=config["thinking_level"],
            architecture=config["architecture"],
            prompt_style=config["prompt_style"],
        )

        start_time = time.perf_counter()
        extract_result = run_extraction_test(PDF_PATH, extractor_config, page_number=0)
        extract_duration = (time.perf_counter() - start_time) * 1000

        extract_scores = score_extraction(extract_result.fields, benchmark)

        print(f"    Fields: {len(extract_result.fields)}")
        print(f"    Time: {extract_duration:.0f}ms")
        print(f"    Detection: {extract_scores.detection_rate:.1f}%")
        print(f"    IoU: {extract_scores.avg_iou:.1f}%")

        # Pass 2: Refinement + questions
        print("  PASS 2: Refinement + questions...")
        refined_result = run_refinement_pass(
            extract_result.fields,
            image_base64,
            thinking_level="medium"  # Use medium thinking for refinement reasoning
        )
        refined_scores = score_extraction(refined_result["fields"], benchmark)

        print(f"    Fields: {len(refined_result['fields'])}")
        print(f"    Questions: {refined_result['questions_generated']}")
        print(f"    Time: {refined_result['duration_ms']:.0f}ms")
        print(f"    Detection: {refined_scores.detection_rate:.1f}%")
        print(f"    IoU: {refined_scores.avg_iou:.1f}%")

        # Calculate deltas
        total_time = extract_duration + refined_result["duration_ms"]
        iou_delta = refined_scores.avg_iou - extract_scores.avg_iou
        detection_delta = refined_scores.detection_rate - extract_scores.detection_rate

        print(f"  DELTA (after refinement):")
        print(f"    IoU: {iou_delta:+.1f}%")
        print(f"    Detection: {detection_delta:+.1f}%")
        print(f"    Total time: {total_time:.0f}ms")
        print()

        results.append({
            "config": config["name"],
            "pass1_extraction": {
                "fields": len(extract_result.fields),
                "duration_ms": extract_duration,
                "detection": extract_scores.detection_rate,
                "iou": extract_scores.avg_iou,
            },
            "pass2_refinement": {
                "fields": len(refined_result["fields"]),
                "questions": refined_result["questions_generated"],
                "duration_ms": refined_result["duration_ms"],
                "detection": refined_scores.detection_rate,
                "iou": refined_scores.avg_iou,
            },
            "delta": {
                "iou": iou_delta,
                "detection": detection_delta,
            },
            "total_duration_ms": total_time,
        })

    # Save results
    output_dir = Path("results/refinement_questions")
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(output_dir / "results.json", "w") as f:
        json.dump(results, f, indent=2)

    # Print summary
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print()
    print(f"{'Config':<45} {'Pass1 IoU':>10} {'Pass2 IoU':>10} {'Δ IoU':>8} {'Qs':>4}")
    print("-" * 82)

    for r in results:
        print(f"{r['config']:<45} "
              f"{r['pass1_extraction']['iou']:>9.1f}% "
              f"{r['pass2_refinement']['iou']:>9.1f}% "
              f"{r['delta']['iou']:>+7.1f}% "
              f"{r['pass2_refinement']['questions']:>4}")

    print()
    print(f"Results saved to: {output_dir}/results.json")

    # Show sample questions from best result
    best = max(results, key=lambda x: x["pass2_refinement"]["iou"])
    print()
    print(f"Sample questions from best result ({best['config']}):")

    # Re-run to get the actual fields with questions
    best_config = next(c for c in CONFIGS_TO_TEST if c["name"] == best["config"])
    extractor_config = ExtractorConfig(
        model=best_config["model"],
        thinking_level=best_config["thinking_level"],
        architecture=best_config["architecture"],
        prompt_style=best_config["prompt_style"],
    )
    extract_result = run_extraction_test(PDF_PATH, extractor_config, page_number=0)
    refined_result = run_refinement_pass(extract_result.fields, image_base64, "medium")

    for field in refined_result["fields"][:5]:
        if field.get("question"):
            print(f"  • {field['label']}: \"{field['question']}\"")


if __name__ == "__main__":
    main()
