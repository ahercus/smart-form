"""
Field extractor for benchmark testing.
Supports single-page and quadrant-based extraction modes.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Literal
from PIL import Image

from .image_processor import (
    pdf_page_to_image,
    resize_for_gemini,
    composite_quadrant_overlay,
    composite_rulers_only,
    image_to_base64,
    QuadrantNumber,
)
from .gemini_client import GeminiClient, GeminiConfig, ExtractionResult, EXTRACTION_RESPONSE_SCHEMA
from .deduplicator import deduplicate_boundary_fields


PromptStyle = Literal["minimal", "high_agency", "medium_agency", "full_rails", "full_rails_no_rulers"]
Architecture = Literal["single_page", "single_page_with_rulers", "quadrant_4"]


@dataclass
class ExtractorConfig:
    """Configuration for field extraction."""
    model: str = "gemini-3-flash-preview"
    thinking_level: str = "low"
    prompt_style: PromptStyle = "medium_agency"
    architecture: Architecture = "quadrant_4"
    use_structured_output: bool = False


@dataclass
class ExtractionTestResult:
    """Complete result from an extraction test."""
    config: ExtractorConfig
    fields: list[dict]
    raw_quadrant_results: list[ExtractionResult] = field(default_factory=list)
    total_duration_ms: float = 0.0
    error: str | None = None


def get_prompt_builder(style: PromptStyle):
    """Get the prompt builder function for a style."""
    import importlib.util
    import sys
    from pathlib import Path

    # Get the configs/prompts directory
    prompts_dir = Path(__file__).parent.parent / "configs" / "prompts"

    def load_module(name: str):
        spec = importlib.util.spec_from_file_location(name, prompts_dir / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    if style == "minimal":
        module = load_module("minimal")
        return lambda quadrant=None: module.build_minimal_prompt()
    elif style == "high_agency":
        module = load_module("high_agency")
        return module.build_high_agency_prompt
    elif style == "medium_agency":
        module = load_module("medium_agency")
        return module.build_medium_agency_prompt
    elif style == "full_rails":
        module = load_module("full_rails")
        return module.build_full_rails_prompt
    elif style == "full_rails_no_rulers":
        module = load_module("full_rails_no_rulers")
        return module.build_full_rails_no_rulers_prompt
    else:
        raise ValueError(f"Unknown prompt style: {style}")


class FieldExtractor:
    """
    Field extractor supporting multiple architectures.

    Architectures:
    - single_page: One Gemini call sees the entire page (no rulers)
    - single_page_with_rulers: One call with rulers but no quadrant highlight
    - quadrant_4: 4 parallel calls, each with purple quadrant overlay
    """

    def __init__(self, config: ExtractorConfig):
        """Initialize extractor with configuration."""
        self.config = config
        self.gemini_client = GeminiClient(
            GeminiConfig(
                model=config.model,
                thinking_level=config.thinking_level
            )
        )
        self.prompt_builder = get_prompt_builder(config.prompt_style)

    def extract_from_pdf(
        self,
        pdf_path: str,
        page_number: int = 0,
        dpi: int = 150
    ) -> ExtractionTestResult:
        """
        Extract fields from a PDF page.

        Args:
            pdf_path: Path to PDF file
            page_number: 0-indexed page number
            dpi: Resolution for PDF conversion

        Returns:
            ExtractionTestResult with extracted fields
        """
        # Convert PDF to image
        image = pdf_page_to_image(pdf_path, page_number, dpi)

        # Resize for Gemini
        resized = resize_for_gemini(image)

        # Run extraction based on architecture
        if self.config.architecture == "single_page":
            return self._extract_single_page(image, with_rulers=False)
        elif self.config.architecture == "single_page_with_rulers":
            return self._extract_single_page(image, with_rulers=True)
        elif self.config.architecture == "quadrant_4":
            return self._extract_quadrants(image)
        else:
            raise ValueError(f"Unknown architecture: {self.config.architecture}")

    def _extract_single_page(
        self,
        image: Image.Image,
        with_rulers: bool = False
    ) -> ExtractionTestResult:
        """Extract from entire page in one call."""
        # Prepare image
        if with_rulers:
            processed = composite_rulers_only(image)
            image_base64 = processed.image_base64
        else:
            resized = resize_for_gemini(image)
            image_base64 = resized.image_base64

        # Get prompt (no quadrant)
        prompt = self.prompt_builder(quadrant=None)

        # Get schema if using structured output
        schema = EXTRACTION_RESPONSE_SCHEMA if self.config.use_structured_output else None

        try:
            result = self.gemini_client.extract_fields(image_base64, prompt, schema)

            return ExtractionTestResult(
                config=self.config,
                fields=result.fields,
                raw_quadrant_results=[result],
                total_duration_ms=result.duration_ms
            )
        except Exception as e:
            return ExtractionTestResult(
                config=self.config,
                fields=[],
                error=str(e)
            )

    def _extract_quadrants(self, image: Image.Image) -> ExtractionTestResult:
        """Extract using 4-quadrant parallel extraction."""
        quadrant_results: list[ExtractionResult] = []
        all_fields: list[dict] = []
        total_duration = 0.0

        # Process each quadrant
        for quadrant in [1, 2, 3, 4]:
            # Create quadrant overlay
            processed = composite_quadrant_overlay(image, quadrant)

            # Get quadrant-specific prompt
            prompt = self.prompt_builder(quadrant=quadrant)

            # Get schema if using structured output
            schema = EXTRACTION_RESPONSE_SCHEMA if self.config.use_structured_output else None

            try:
                result = self.gemini_client.extract_fields(
                    processed.image_base64,
                    prompt,
                    schema
                )
                quadrant_results.append(result)
                total_duration += result.duration_ms

                # Add quadrant info to fields
                for field in result.fields:
                    field["_quadrant"] = quadrant
                    all_fields.append(field)

            except Exception as e:
                return ExtractionTestResult(
                    config=self.config,
                    fields=all_fields,
                    raw_quadrant_results=quadrant_results,
                    total_duration_ms=total_duration,
                    error=f"Quadrant {quadrant} failed: {str(e)}"
                )

        # Deduplicate fields at quadrant boundaries
        deduplicated = deduplicate_boundary_fields(all_fields)

        return ExtractionTestResult(
            config=self.config,
            fields=deduplicated,
            raw_quadrant_results=quadrant_results,
            total_duration_ms=total_duration
        )

    async def _extract_quadrants_async(
        self,
        image: Image.Image
    ) -> ExtractionTestResult:
        """Extract using 4-quadrant parallel extraction (async version)."""
        # Prepare all quadrant images
        quadrant_images = []
        for quadrant in [1, 2, 3, 4]:
            processed = composite_quadrant_overlay(image, quadrant)
            prompt = self.prompt_builder(quadrant=quadrant)
            quadrant_images.append((quadrant, processed.image_base64, prompt))

        # Run all extractions in parallel
        async def extract_one(quadrant, image_base64, prompt):
            # Run in thread pool since Gemini client is sync
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(
                None,
                lambda: (quadrant, self.gemini_client.extract_fields(image_base64, prompt))
            )

        try:
            results = await asyncio.gather(*[
                extract_one(q, img, prompt)
                for q, img, prompt in quadrant_images
            ])

            all_fields = []
            quadrant_results = []
            total_duration = 0.0

            for quadrant, result in sorted(results, key=lambda x: x[0]):
                quadrant_results.append(result)
                total_duration += result.duration_ms

                for field in result.fields:
                    field["_quadrant"] = quadrant
                    all_fields.append(field)

            # Deduplicate
            deduplicated = deduplicate_boundary_fields(all_fields)

            return ExtractionTestResult(
                config=self.config,
                fields=deduplicated,
                raw_quadrant_results=quadrant_results,
                total_duration_ms=total_duration
            )

        except Exception as e:
            return ExtractionTestResult(
                config=self.config,
                fields=[],
                error=str(e)
            )


def run_extraction_test(
    pdf_path: str,
    config: ExtractorConfig,
    page_number: int = 0
) -> ExtractionTestResult:
    """
    Run a single extraction test with given configuration.

    Args:
        pdf_path: Path to PDF file
        config: Extraction configuration
        page_number: 0-indexed page number

    Returns:
        ExtractionTestResult
    """
    extractor = FieldExtractor(config)
    return extractor.extract_from_pdf(pdf_path, page_number)
