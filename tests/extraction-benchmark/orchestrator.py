#!/usr/bin/env python3
"""
Extraction Benchmark Orchestrator

Runs the full test matrix of model × architecture × prompt combinations
and generates comparison reports.

Test Matrix:
- Models: gemini-3-flash-preview (MINIMAL, MEDIUM)
- Architectures: single_page, single_page_with_rulers, quadrant_4
- Prompts: minimal, high_agency, medium_agency, full_rails

Total: 2 models × 2 thinking × 3 architectures × 4 prompts = 48 configurations
"""

import asyncio
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Iterator

from core import (
    ExtractorConfig,
    run_extraction_test,
    ExtractionTestResult,
    PromptStyle,
    Architecture,
)
from evaluation import score_extraction, ExtractionScore
from tools.visualize_benchmark import render_fields_on_image
from core.image_processor import pdf_page_to_image


# Default parallelism - respects Gemini rate limits
DEFAULT_PARALLEL_TESTS = 4


# Test matrix configuration
MODELS = ["gemini-3-flash-preview"]  # Pro reserved for future
THINKING_LEVELS = ["MINIMAL", "MEDIUM"]
ARCHITECTURES: list[Architecture] = ["single_page", "single_page_with_rulers", "quadrant_4"]
PROMPT_STYLES: list[PromptStyle] = ["minimal", "high_agency", "medium_agency", "full_rails"]


@dataclass
class TestConfig:
    """A single test configuration."""
    model: str
    thinking_level: str
    architecture: Architecture
    prompt_style: PromptStyle

    @property
    def name(self) -> str:
        """Generate unique name for this config."""
        model_short = "flash" if "flash" in self.model else "pro"
        return f"{model_short}_{self.thinking_level.lower()}_{self.architecture}_{self.prompt_style}"


@dataclass
class TestResult:
    """Result of a single test run."""
    config: TestConfig
    extraction: ExtractionTestResult
    score: ExtractionScore
    duration_ms: float


def generate_test_matrix() -> Iterator[TestConfig]:
    """Generate all test configurations."""
    for model in MODELS:
        for thinking in THINKING_LEVELS:
            for arch in ARCHITECTURES:
                for prompt in PROMPT_STYLES:
                    yield TestConfig(
                        model=model,
                        thinking_level=thinking,
                        architecture=arch,
                        prompt_style=prompt
                    )


def load_benchmark(benchmark_path: str) -> list[dict]:
    """Load ground truth benchmark."""
    with open(benchmark_path) as f:
        data = json.load(f)
    return data.get("fields", [])


def run_single_test(
    config: TestConfig,
    pdf_path: str,
    benchmark: list[dict],
    page_number: int = 0
) -> TestResult:
    """
    Run a single extraction test.

    Args:
        config: Test configuration
        pdf_path: Path to PDF file
        benchmark: Ground truth fields
        page_number: Page to extract

    Returns:
        TestResult with extraction and scores
    """
    print(f"  Running: {config.name}...")

    extractor_config = ExtractorConfig(
        model=config.model,
        thinking_level=config.thinking_level,
        architecture=config.architecture,
        prompt_style=config.prompt_style
    )

    start_time = time.perf_counter()
    extraction = run_extraction_test(pdf_path, extractor_config, page_number)
    duration = (time.perf_counter() - start_time) * 1000

    # Score against benchmark
    score = score_extraction(extraction.fields, benchmark)

    return TestResult(
        config=config,
        extraction=extraction,
        score=score,
        duration_ms=duration
    )


def save_result(result: TestResult, output_dir: Path):
    """Save extraction result to JSON."""
    raw_dir = output_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    output_file = raw_dir / f"{result.config.name}.json"

    data = {
        "config": asdict(result.config),
        "fields": result.extraction.fields,
        "score": {
            "detection_rate": result.score.detection_rate,
            "precision_rate": result.score.precision_rate,
            "avg_iou": result.score.avg_iou,
            "type_accuracy": result.score.type_accuracy,
            "label_accuracy": result.score.label_accuracy,
            "overall_score": result.score.overall_score,
        },
        "duration_ms": result.duration_ms,
        "error": result.extraction.error,
    }

    with open(output_file, "w") as f:
        json.dump(data, f, indent=2)


def save_visualization(
    result: TestResult,
    pdf_path: str,
    output_dir: Path,
    page_number: int = 0,
    dpi: int = 150
):
    """Save visualization of extraction result."""
    from PIL import Image

    vis_dir = output_dir / "visualizations"
    vis_dir.mkdir(parents=True, exist_ok=True)

    # Load page image
    image = pdf_page_to_image(pdf_path, page_number, dpi)

    # Render fields
    result_image = render_fields_on_image(image, result.extraction.fields)

    # Save
    output_file = vis_dir / f"{result.config.name}.png"
    result_image.save(output_file, "PNG")


def generate_report(results: list[TestResult], output_dir: Path):
    """Generate markdown comparison report."""
    report_path = output_dir / "report.md"

    # Sort by overall score
    sorted_results = sorted(results, key=lambda r: r.score.overall_score, reverse=True)

    lines = [
        "# Extraction Benchmark Report",
        "",
        f"Generated: {datetime.now().isoformat()}",
        "",
        "## Summary",
        "",
        f"Total configurations tested: {len(results)}",
        "",
        "### Top 5 Configurations",
        "",
        "| Rank | Configuration | Overall | Detection | IoU | Types | Labels |",
        "|------|---------------|---------|-----------|-----|-------|--------|",
    ]

    for i, r in enumerate(sorted_results[:5], 1):
        lines.append(
            f"| {i} | {r.config.name} | {r.score.overall_score:.1f}% | "
            f"{r.score.detection_rate:.1f}% | {r.score.avg_iou:.1f}% | "
            f"{r.score.type_accuracy:.1f}% | {r.score.label_accuracy:.1f}% |"
        )

    lines.extend([
        "",
        "## All Results",
        "",
        "| Configuration | Overall | Detection | Precision | IoU | Types | Labels | Time |",
        "|---------------|---------|-----------|-----------|-----|-------|--------|------|",
    ])

    for r in sorted_results:
        lines.append(
            f"| {r.config.name} | {r.score.overall_score:.1f}% | "
            f"{r.score.detection_rate:.1f}% | {r.score.precision_rate:.1f}% | "
            f"{r.score.avg_iou:.1f}% | {r.score.type_accuracy:.1f}% | "
            f"{r.score.label_accuracy:.1f}% | {r.duration_ms:.0f}ms |"
        )

    # Analysis by dimension
    lines.extend([
        "",
        "## Analysis by Dimension",
        "",
        "### By Architecture",
        "",
    ])

    for arch in ARCHITECTURES:
        arch_results = [r for r in sorted_results if r.config.architecture == arch]
        if arch_results:
            avg_score = sum(r.score.overall_score for r in arch_results) / len(arch_results)
            lines.append(f"- **{arch}**: {avg_score:.1f}% average")

    lines.extend([
        "",
        "### By Prompt Style",
        "",
    ])

    for prompt in PROMPT_STYLES:
        prompt_results = [r for r in sorted_results if r.config.prompt_style == prompt]
        if prompt_results:
            avg_score = sum(r.score.overall_score for r in prompt_results) / len(prompt_results)
            lines.append(f"- **{prompt}**: {avg_score:.1f}% average")

    lines.extend([
        "",
        "### By Thinking Level",
        "",
    ])

    for thinking in THINKING_LEVELS:
        think_results = [r for r in sorted_results if r.config.thinking_level == thinking]
        if think_results:
            avg_score = sum(r.score.overall_score for r in think_results) / len(think_results)
            lines.append(f"- **{thinking}**: {avg_score:.1f}% average")

    # Best configuration recommendation
    best = sorted_results[0] if sorted_results else None
    if best:
        lines.extend([
            "",
            "## Recommendation",
            "",
            f"**Best Configuration: {best.config.name}**",
            "",
            f"- Overall Score: {best.score.overall_score:.1f}%",
            f"- Detection Rate: {best.score.detection_rate:.1f}%",
            f"- Precision: {best.score.precision_rate:.1f}%",
            f"- Average IoU: {best.score.avg_iou:.1f}%",
            f"- Type Accuracy: {best.score.type_accuracy:.1f}%",
            f"- Label Accuracy: {best.score.label_accuracy:.1f}%",
            f"- Extraction Time: {best.duration_ms:.0f}ms",
        ])

    with open(report_path, "w") as f:
        f.write("\n".join(lines))

    print(f"\nReport saved to: {report_path}")


def run_benchmark(
    pdf_path: str,
    benchmark_path: str,
    output_dir: str,
    page_number: int = 0,
    visualize: bool = True,
    max_tests: int | None = None,
    parallel: int = DEFAULT_PARALLEL_TESTS
):
    """
    Run the full benchmark test matrix.

    Args:
        pdf_path: Path to PDF document
        benchmark_path: Path to benchmark JSON
        output_dir: Directory for results
        page_number: Page to extract (0-indexed)
        visualize: Whether to generate visualization PNGs
        max_tests: Optional limit on number of tests (for debugging)
        parallel: Number of tests to run in parallel (default 4)
    """
    print(f"Loading benchmark from: {benchmark_path}")
    benchmark = load_benchmark(benchmark_path)
    print(f"Benchmark has {len(benchmark)} fields")

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    results: list[TestResult] = []
    test_configs = list(generate_test_matrix())

    if max_tests:
        test_configs = test_configs[:max_tests]

    print(f"\nRunning {len(test_configs)} test configurations with {parallel} parallel workers...")

    def run_test_wrapper(config: TestConfig) -> tuple[TestConfig, TestResult | None, str | None]:
        """Wrapper for parallel execution."""
        try:
            result = run_single_test(config, pdf_path, benchmark, page_number)
            return (config, result, None)
        except Exception as e:
            return (config, None, str(e))

    completed = 0
    with ThreadPoolExecutor(max_workers=parallel) as executor:
        # Submit all tests
        future_to_config = {
            executor.submit(run_test_wrapper, config): config
            for config in test_configs
        }

        # Process as they complete
        for future in as_completed(future_to_config):
            completed += 1
            config, result, error = future.result()

            if error:
                print(f"[{completed}/{len(test_configs)}] {config.name}: ERROR - {error}")
            else:
                results.append(result)

                # Save result
                save_result(result, output_path)

                # Generate visualization
                if visualize:
                    save_visualization(result, pdf_path, output_path, page_number)

                print(f"[{completed}/{len(test_configs)}] {config.name}: "
                      f"{result.score.overall_score:.1f}% "
                      f"(Det: {result.score.detection_rate:.0f}%, "
                      f"IoU: {result.score.avg_iou:.0f}%)")

    # Generate report
    if results:
        generate_report(results, output_path)

        # Save all scores to JSON
        scores_dir = output_path / "scores"
        scores_dir.mkdir(parents=True, exist_ok=True)

        all_scores = [
            {
                "config": r.config.name,
                "overall": r.score.overall_score,
                "detection": r.score.detection_rate,
                "precision": r.score.precision_rate,
                "iou": r.score.avg_iou,
                "types": r.score.type_accuracy,
                "labels": r.score.label_accuracy,
                "duration_ms": r.duration_ms,
            }
            for r in results
        ]

        with open(scores_dir / "all_scores.json", "w") as f:
            json.dump(all_scores, f, indent=2)

    print(f"\nBenchmark complete! Results saved to: {output_dir}")


if __name__ == "__main__":
    # Default paths
    script_dir = Path(__file__).parent
    default_pdf = script_dir.parent.parent / "docs" / "tests" / "Prep Questionnaire 2025.pdf"
    default_benchmark = script_dir / "benchmark" / "prep_questionnaire_page1.json"
    default_output = script_dir / "results"

    # Parse arguments
    import argparse
    parser = argparse.ArgumentParser(description="Run extraction benchmark")
    parser.add_argument("--pdf", type=str, default=str(default_pdf),
                        help="Path to PDF file")
    parser.add_argument("--benchmark", type=str, default=str(default_benchmark),
                        help="Path to benchmark JSON")
    parser.add_argument("--output", type=str, default=str(default_output),
                        help="Output directory for results")
    parser.add_argument("--page", type=int, default=0,
                        help="Page number (0-indexed)")
    parser.add_argument("--no-visualize", action="store_true",
                        help="Skip generating visualization PNGs")
    parser.add_argument("--max-tests", type=int, default=None,
                        help="Limit number of tests (for debugging)")
    parser.add_argument("--parallel", type=int, default=DEFAULT_PARALLEL_TESTS,
                        help=f"Number of parallel workers (default {DEFAULT_PARALLEL_TESTS})")

    args = parser.parse_args()

    # Check API key
    if not os.environ.get("GEMINI_API_KEY") and not os.environ.get("GOOGLE_API_KEY"):
        print("ERROR: Set GEMINI_API_KEY or GOOGLE_API_KEY environment variable")
        sys.exit(1)

    run_benchmark(
        pdf_path=args.pdf,
        benchmark_path=args.benchmark,
        output_dir=args.output,
        page_number=args.page,
        visualize=not args.no_visualize,
        max_tests=args.max_tests,
        parallel=args.parallel
    )
