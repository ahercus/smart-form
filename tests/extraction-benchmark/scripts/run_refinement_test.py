#!/usr/bin/env python3
"""
Refinement test: Can Gemini fix Azure OCR output?

Tests the top configs on their ability to refine/correct OCR-detected fields.
"""

import json
import sys
import time
import base64
from pathlib import Path
from dataclasses import asdict

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.gemini_client import GeminiClient, GeminiConfig
from core.image_processor import resize_for_gemini
from configs.prompts.refinement import build_refinement_prompt, build_refinement_prompt_minimal
from evaluation.scorer import score_extraction
from tools.visualize_benchmark import render_fields_on_image
from pdf2image import convert_from_path
from PIL import Image


# Configs to test
CONFIGS_TO_TEST = [
    {"model": "gemini-3-flash-preview", "thinking_level": "medium", "name": "flash_medium"},
    {"model": "gemini-3-flash-preview", "thinking_level": "low", "name": "flash_low"},
    {"model": "gemini-3-pro-preview", "thinking_level": "low", "name": "pro_low"},
]

PROMPT_VARIANTS = ["full", "minimal"]


def load_azure_draft() -> list[dict]:
    """Load the Azure OCR draft fields."""
    with open("benchmark/azure_ocr_draft.json") as f:
        data = json.load(f)
    return data["fields"]


def load_benchmark() -> list[dict]:
    """Load ground truth benchmark."""
    with open("benchmark/prep_questionnaire_page1.json") as f:
        data = json.load(f)
    return data["fields"]


def get_page_image_base64(pdf_path: str, dpi: int = 150) -> tuple[str, Image.Image]:
    """Convert PDF page to base64 and return both base64 and PIL image."""
    images = convert_from_path(pdf_path, dpi=dpi, first_page=1, last_page=1)
    if not images:
        raise ValueError("Could not convert PDF")

    page_image = images[0]

    # Resize for Gemini and get base64
    processed = resize_for_gemini(page_image)

    return processed.image_base64, page_image


def run_refinement_test(
    config: dict,
    prompt_variant: str,
    ocr_fields: list[dict],
    image_base64: str,
    benchmark: list[dict],
) -> dict:
    """Run a single refinement test."""
    config_name = f"{config['name']}_{prompt_variant}"
    print(f"  Running: {config_name}...")

    # Build prompt
    if prompt_variant == "minimal":
        prompt = build_refinement_prompt_minimal(ocr_fields)
    else:
        prompt = build_refinement_prompt(ocr_fields)

    # Create client
    client = GeminiClient(GeminiConfig(
        model=config["model"],
        thinking_level=config["thinking_level"],
    ))

    start_time = time.perf_counter()

    try:
        result = client.extract_fields(image_base64, prompt)
        duration_ms = (time.perf_counter() - start_time) * 1000

        # Score the result
        scores = score_extraction(result.fields, benchmark)

        return {
            "config": config_name,
            "model": config["model"],
            "thinking_level": config["thinking_level"],
            "prompt_variant": prompt_variant,
            "fields": result.fields,
            "score": {
                "overall_score": scores.overall_score,
                "detection_rate": scores.detection_rate,
                "precision_rate": scores.precision_rate,
                "avg_iou": scores.avg_iou,
                "type_accuracy": scores.type_accuracy,
                "label_accuracy": scores.label_accuracy,
            },
            "duration_ms": duration_ms,
            "error": None,
            "refinement_notes": result.raw_response.get("refinement_notes", ""),
        }

    except Exception as e:
        duration_ms = (time.perf_counter() - start_time) * 1000
        return {
            "config": config_name,
            "model": config["model"],
            "thinking_level": config["thinking_level"],
            "prompt_variant": prompt_variant,
            "fields": [],
            "score": None,
            "duration_ms": duration_ms,
            "error": str(e),
        }


def main():
    print("=" * 60)
    print("REFINEMENT TEST: Can Gemini fix Azure OCR output?")
    print("=" * 60)
    print()

    # Load data
    print("Loading data...")
    ocr_fields = load_azure_draft()
    benchmark = load_benchmark()
    print(f"  OCR fields: {len(ocr_fields)}")
    print(f"  Benchmark fields: {len(benchmark)}")

    # Get page image
    pdf_path = "/Users/allisterhercus/Documents/Labs/smart-form/docs/tests/Prep Questionnaire 2025.pdf"
    print(f"  Loading PDF: {pdf_path}")
    image_base64, page_image = get_page_image_base64(pdf_path)

    # First, score the raw Azure output as baseline
    print()
    print("Scoring raw Azure OCR output (baseline)...")
    azure_score_obj = score_extraction(ocr_fields, benchmark)
    azure_scores = {
        "overall_score": azure_score_obj.overall_score,
        "detection_rate": azure_score_obj.detection_rate,
        "precision_rate": azure_score_obj.precision_rate,
        "avg_iou": azure_score_obj.avg_iou,
        "type_accuracy": azure_score_obj.type_accuracy,
        "label_accuracy": azure_score_obj.label_accuracy,
    }
    print(f"  Azure baseline: {azure_scores['overall_score']:.1f}%")
    print(f"    Detection: {azure_scores['detection_rate']:.1f}%")
    print(f"    IoU: {azure_scores['avg_iou']:.1f}%")
    print(f"    Types: {azure_scores['type_accuracy']:.1f}%")

    # Run tests
    print()
    print(f"Running {len(CONFIGS_TO_TEST) * len(PROMPT_VARIANTS)} refinement tests...")

    results = []
    for config in CONFIGS_TO_TEST:
        for prompt_variant in PROMPT_VARIANTS:
            result = run_refinement_test(
                config, prompt_variant, ocr_fields, image_base64, benchmark
            )
            results.append(result)

            if result["error"]:
                print(f"    [{len(results)}/{len(CONFIGS_TO_TEST) * len(PROMPT_VARIANTS)}] {result['config']}: ERROR - {result['error'][:50]}")
            else:
                print(f"    [{len(results)}/{len(CONFIGS_TO_TEST) * len(PROMPT_VARIANTS)}] {result['config']}: {result['score']['overall_score']:.1f}%")

    # Save results
    output_dir = Path("results/refinement")
    output_dir.mkdir(parents=True, exist_ok=True)

    for result in results:
        with open(output_dir / f"{result['config']}.json", "w") as f:
            json.dump(result, f, indent=2)

    # Save summary
    summary = {
        "azure_baseline": azure_scores,
        "tests": [
            {
                "config": r["config"],
                "overall": r["score"]["overall_score"] if r["score"] else 0,
                "detection": r["score"]["detection_rate"] if r["score"] else 0,
                "iou": r["score"]["avg_iou"] if r["score"] else 0,
                "types": r["score"]["type_accuracy"] if r["score"] else 0,
                "duration_ms": r["duration_ms"],
                "error": r["error"],
            }
            for r in results
        ],
    }

    with open(output_dir / "summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    # Generate visualizations
    print()
    print("Generating visualizations...")
    vis_dir = output_dir / "visualizations"
    vis_dir.mkdir(exist_ok=True)

    # Azure baseline visualization
    azure_vis = render_fields_on_image(page_image, ocr_fields)
    azure_vis.save(vis_dir / "azure_baseline.png")
    print(f"  Saved: azure_baseline.png")

    # Each result visualization
    for result in results:
        if result["fields"]:
            vis = render_fields_on_image(page_image, result["fields"])
            vis.save(vis_dir / f"{result['config']}.png")
            print(f"  Saved: {result['config']}.png")

    # Print summary
    print()
    print("=" * 60)
    print("RESULTS SUMMARY")
    print("=" * 60)
    print()
    print(f"{'Config':<30} {'Overall':>10} {'IoU':>10} {'Types':>10} {'vs Azure':>10}")
    print("-" * 70)
    print(f"{'Azure Baseline':<30} {azure_scores['overall_score']:>9.1f}% {azure_scores['avg_iou']:>9.1f}% {azure_scores['type_accuracy']:>9.1f}% {'-':>10}")

    for r in sorted(results, key=lambda x: (x["score"]["overall_score"] if x["score"] else 0), reverse=True):
        if r["score"]:
            improvement = r["score"]["overall_score"] - azure_scores["overall_score"]
            print(f"{r['config']:<30} {r['score']['overall_score']:>9.1f}% {r['score']['avg_iou']:>9.1f}% {r['score']['type_accuracy']:>9.1f}% {improvement:>+9.1f}%")
        else:
            print(f"{r['config']:<30} {'ERROR':>10} {'-':>10} {'-':>10} {'-':>10}")

    print()
    print(f"Results saved to: {output_dir}")


if __name__ == "__main__":
    main()
