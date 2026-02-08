"""
Evaluation modules for extraction benchmark.
"""

from .scorer import (
    score_extraction,
    match_fields,
    calculate_iou,
    calculate_label_similarity,
    types_compatible,
    ExtractionScore,
    FieldMatch,
)

__all__ = [
    "score_extraction",
    "match_fields",
    "calculate_iou",
    "calculate_label_similarity",
    "types_compatible",
    "ExtractionScore",
    "FieldMatch",
]
