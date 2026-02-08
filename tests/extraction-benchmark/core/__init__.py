"""
Core modules for extraction benchmark testing.
"""

from .image_processor import (
    pdf_page_to_image,
    resize_for_gemini,
    composite_quadrant_overlay,
    composite_rulers_only,
    image_to_base64,
    base64_to_image,
    ProcessedImage,
    QuadrantNumber,
)

from .gemini_client import (
    GeminiClient,
    GeminiConfig,
    ExtractionResult,
    ExtractionError,
    EXTRACTION_RESPONSE_SCHEMA,
)

from .field_extractor import (
    FieldExtractor,
    ExtractorConfig,
    ExtractionTestResult,
    run_extraction_test,
    PromptStyle,
    Architecture,
)

from .deduplicator import (
    deduplicate_boundary_fields,
    deduplicate_by_position,
    fields_match,
    coordinates_match,
)

__all__ = [
    # Image processing
    "pdf_page_to_image",
    "resize_for_gemini",
    "composite_quadrant_overlay",
    "composite_rulers_only",
    "image_to_base64",
    "base64_to_image",
    "ProcessedImage",
    "QuadrantNumber",
    # Gemini client
    "GeminiClient",
    "GeminiConfig",
    "ExtractionResult",
    "ExtractionError",
    "EXTRACTION_RESPONSE_SCHEMA",
    # Field extractor
    "FieldExtractor",
    "ExtractorConfig",
    "ExtractionTestResult",
    "run_extraction_test",
    "PromptStyle",
    "Architecture",
    # Deduplicator
    "deduplicate_boundary_fields",
    "deduplicate_by_position",
    "fields_match",
    "coordinates_match",
]
