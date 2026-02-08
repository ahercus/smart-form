"""
Scoring system for extraction benchmark.
Compares predicted extractions against ground truth benchmark.
All metrics are percentage-based (0-100%).
"""

from dataclasses import dataclass, field
from typing import Optional
import Levenshtein
from scipy.optimize import linear_sum_assignment
import numpy as np


@dataclass
class FieldMatch:
    """A matched pair of predicted and ground truth fields."""
    predicted: dict
    ground_truth: dict
    iou: float  # Intersection over Union (0-1)
    label_similarity: float  # Fuzzy string match (0-1)
    type_correct: bool  # Whether field types match


@dataclass
class ExtractionScore:
    """Complete scoring results for an extraction."""
    # Detection metrics (0-100)
    detection_rate: float  # % of ground truth fields found (recall)
    precision_rate: float  # % of predicted fields that are valid

    # Coordinate metrics (0-100)
    avg_iou: float  # Average IoU across matched fields
    iou_distribution: dict  # {"<25%": n, "25-50%": n, "50-75%": n, ">75%": n}

    # Field type metrics (0-100)
    type_accuracy: float  # % of matched fields with correct type
    type_confusion: dict  # {expected: {predicted: count}}

    # Label metrics (0-100)
    label_accuracy: float  # Average label similarity

    # Table-specific
    table_detection: bool  # Did it find tables as tables?
    table_cell_accuracy: float  # After expansion, % correct cells

    # Details
    matched_fields: list[FieldMatch]
    missed_fields: list[dict]  # Ground truth not found
    extra_fields: list[dict]  # Predicted not in ground truth

    # Overall weighted score
    overall_score: float

    @property
    def summary(self) -> str:
        """Human-readable summary of scores."""
        return f"""
Detection: {self.detection_rate:.1f}% recall, {self.precision_rate:.1f}% precision
Coordinates: {self.avg_iou:.1f}% avg IoU
Types: {self.type_accuracy:.1f}% correct
Labels: {self.label_accuracy:.1f}% similarity
Overall: {self.overall_score:.1f}%
Matched: {len(self.matched_fields)}, Missed: {len(self.missed_fields)}, Extra: {len(self.extra_fields)}
"""


def calculate_iou(pred_coords: dict, truth_coords: dict) -> float:
    """
    Calculate Intersection over Union for two bounding boxes.

    Both boxes are in percentage coordinates (0-100).

    Args:
        pred_coords: Predicted coordinates {left, top, width, height}
        truth_coords: Ground truth coordinates {left, top, width, height}

    Returns:
        IoU score (0.0 to 1.0)
    """
    # Extract coordinates
    p_left = pred_coords.get("left", 0)
    p_top = pred_coords.get("top", 0)
    p_right = p_left + pred_coords.get("width", 0)
    p_bottom = p_top + pred_coords.get("height", 0)

    t_left = truth_coords.get("left", 0)
    t_top = truth_coords.get("top", 0)
    t_right = t_left + truth_coords.get("width", 0)
    t_bottom = t_top + truth_coords.get("height", 0)

    # Calculate intersection
    inter_left = max(p_left, t_left)
    inter_top = max(p_top, t_top)
    inter_right = min(p_right, t_right)
    inter_bottom = min(p_bottom, t_bottom)

    if inter_right <= inter_left or inter_bottom <= inter_top:
        return 0.0

    inter_area = (inter_right - inter_left) * (inter_bottom - inter_top)

    # Calculate union
    p_area = (p_right - p_left) * (p_bottom - p_top)
    t_area = (t_right - t_left) * (t_bottom - t_top)
    union_area = p_area + t_area - inter_area

    if union_area <= 0:
        return 0.0

    return inter_area / union_area


def calculate_label_similarity(pred_label: str, truth_label: str) -> float:
    """
    Calculate fuzzy string similarity between labels.

    Uses Levenshtein ratio for matching.

    Args:
        pred_label: Predicted label
        truth_label: Ground truth label

    Returns:
        Similarity score (0.0 to 1.0)
    """
    if not pred_label or not truth_label:
        return 0.0

    # Normalize: lowercase, strip
    norm_pred = pred_label.lower().strip()
    norm_truth = truth_label.lower().strip()

    if norm_pred == norm_truth:
        return 1.0

    return Levenshtein.ratio(norm_pred, norm_truth)


def types_compatible(pred_type: str, truth_type: str) -> bool:
    """
    Check if predicted type is compatible with ground truth type.

    Some types are acceptable alternatives:
    - textarea can match text (fallback)
    - date can match linkedDate (fallback)
    - TEXT/CHECKBOX (uppercase) match lowercase versions

    Args:
        pred_type: Predicted field type
        truth_type: Ground truth field type

    Returns:
        True if types are compatible
    """
    # Normalize to lowercase
    pred = pred_type.lower().strip()
    truth = truth_type.lower().strip()

    if pred == truth:
        return True

    # Define compatible mappings
    compatible_pairs = {
        ("text", "textarea"),  # text is acceptable for textarea
        ("textarea", "text"),  # textarea could be used for text
        ("date", "linkeddate"),  # date fallback for linkedDate
        ("linkeddate", "date"),  # linkedDate for simple date
    }

    return (pred, truth) in compatible_pairs or (truth, pred) in compatible_pairs


def match_fields(
    predicted: list[dict],
    ground_truth: list[dict],
    iou_threshold: float = 0.1
) -> tuple[list[FieldMatch], list[dict], list[dict]]:
    """
    Match predicted fields to ground truth using Hungarian algorithm.

    Optimizes for maximum total matching score (IoU + label similarity).

    Args:
        predicted: List of predicted field dicts
        ground_truth: List of ground truth field dicts
        iou_threshold: Minimum IoU to consider a match

    Returns:
        Tuple of (matched_pairs, missed_fields, extra_fields)
    """
    if not predicted or not ground_truth:
        return [], ground_truth.copy(), predicted.copy()

    n_pred = len(predicted)
    n_truth = len(ground_truth)

    # Build cost matrix (negative score since we minimize)
    cost_matrix = np.zeros((n_pred, n_truth))

    for i, pred in enumerate(predicted):
        pred_coords = pred.get("coordinates", pred.get("box", {}))
        pred_label = pred.get("label", "")

        for j, truth in enumerate(ground_truth):
            truth_coords = truth.get("coordinates", {})

            # For special types, get coords from nested structure
            if "tableConfig" in truth:
                truth_coords = truth["tableConfig"].get("coordinates", {})
            elif "dateSegments" in truth and not truth_coords:
                # Calculate bounding box from segments
                truth_coords = _bounding_box_from_segments(truth["dateSegments"])

            truth_label = truth.get("label", "")

            # Calculate matching score
            iou = calculate_iou(pred_coords, truth_coords)
            label_sim = calculate_label_similarity(pred_label, truth_label)

            # Combined score (weighted)
            score = 0.6 * iou + 0.4 * label_sim

            # Only consider if IoU is above threshold
            if iou < iou_threshold:
                score = 0.0

            cost_matrix[i, j] = -score  # Negative for minimization

    # Run Hungarian algorithm
    row_ind, col_ind = linear_sum_assignment(cost_matrix)

    matched = []
    matched_pred_indices = set()
    matched_truth_indices = set()

    for pred_idx, truth_idx in zip(row_ind, col_ind):
        if -cost_matrix[pred_idx, truth_idx] > 0:  # Valid match
            pred = predicted[pred_idx]
            truth = ground_truth[truth_idx]

            pred_coords = pred.get("coordinates", pred.get("box", {}))
            truth_coords = truth.get("coordinates", {})

            if "tableConfig" in truth:
                truth_coords = truth["tableConfig"].get("coordinates", {})
            elif "dateSegments" in truth and not truth_coords:
                truth_coords = _bounding_box_from_segments(truth["dateSegments"])

            iou = calculate_iou(pred_coords, truth_coords)
            label_sim = calculate_label_similarity(
                pred.get("label", ""),
                truth.get("label", "")
            )

            pred_type = pred.get("fieldType", pred.get("type", "unknown"))
            truth_type = truth.get("fieldType", truth.get("type", "unknown"))
            type_correct = types_compatible(pred_type, truth_type)

            matched.append(FieldMatch(
                predicted=pred,
                ground_truth=truth,
                iou=iou,
                label_similarity=label_sim,
                type_correct=type_correct
            ))

            matched_pred_indices.add(pred_idx)
            matched_truth_indices.add(truth_idx)

    # Collect unmatched
    missed = [ground_truth[i] for i in range(n_truth) if i not in matched_truth_indices]
    extra = [predicted[i] for i in range(n_pred) if i not in matched_pred_indices]

    return matched, missed, extra


def _bounding_box_from_segments(segments: list[dict]) -> dict:
    """Calculate bounding box from list of segment coordinates."""
    if not segments:
        return {"left": 0, "top": 0, "width": 0, "height": 0}

    min_left = min(s.get("left", 0) for s in segments)
    min_top = min(s.get("top", 0) for s in segments)
    max_right = max(s.get("left", 0) + s.get("width", 0) for s in segments)
    max_bottom = max(s.get("top", 0) + s.get("height", 0) for s in segments)

    return {
        "left": min_left,
        "top": min_top,
        "width": max_right - min_left,
        "height": max_bottom - min_top
    }


def score_extraction(
    predicted: list[dict],
    ground_truth: list[dict],
    weights: Optional[dict] = None
) -> ExtractionScore:
    """
    Score an extraction against ground truth benchmark.

    All metrics are returned as percentages (0-100).

    Args:
        predicted: List of predicted field dicts
        ground_truth: List of ground truth field dicts
        weights: Optional custom weights for overall score

    Returns:
        ExtractionScore with all metrics
    """
    if weights is None:
        weights = {
            "detection_rate": 0.25,
            "precision_rate": 0.10,
            "avg_iou": 0.30,
            "type_accuracy": 0.20,
            "label_accuracy": 0.15,
        }

    # Match fields
    matched, missed, extra = match_fields(predicted, ground_truth)

    # Detection metrics
    n_truth = len(ground_truth)
    n_pred = len(predicted)
    n_matched = len(matched)

    detection_rate = (n_matched / n_truth * 100) if n_truth > 0 else 0
    precision_rate = (n_matched / n_pred * 100) if n_pred > 0 else 0

    # Coordinate metrics
    ious = [m.iou for m in matched]
    avg_iou = (sum(ious) / len(ious) * 100) if ious else 0

    iou_distribution = {
        "<25%": sum(1 for iou in ious if iou < 0.25),
        "25-50%": sum(1 for iou in ious if 0.25 <= iou < 0.5),
        "50-75%": sum(1 for iou in ious if 0.5 <= iou < 0.75),
        ">75%": sum(1 for iou in ious if iou >= 0.75),
    }

    # Type metrics
    type_correct_count = sum(1 for m in matched if m.type_correct)
    type_accuracy = (type_correct_count / n_matched * 100) if n_matched > 0 else 0

    # Build confusion matrix
    type_confusion: dict = {}
    for m in matched:
        truth_type = m.ground_truth.get("fieldType", "unknown")
        pred_type = m.predicted.get("fieldType", m.predicted.get("type", "unknown"))

        if truth_type not in type_confusion:
            type_confusion[truth_type] = {}
        if pred_type not in type_confusion[truth_type]:
            type_confusion[truth_type][pred_type] = 0
        type_confusion[truth_type][pred_type] += 1

    # Label metrics
    label_sims = [m.label_similarity for m in matched]
    label_accuracy = (sum(label_sims) / len(label_sims) * 100) if label_sims else 0

    # Table-specific metrics
    truth_tables = [f for f in ground_truth if f.get("fieldType") == "table"]
    pred_tables = [f for f in predicted if f.get("fieldType") == "table"]
    table_detection = len(pred_tables) >= len(truth_tables) if truth_tables else True

    # Table cell accuracy would require expanding tables and comparing cells
    # For now, we'll use IoU of matched table fields
    table_matches = [m for m in matched if m.ground_truth.get("fieldType") == "table"]
    table_cell_accuracy = (
        sum(m.iou for m in table_matches) / len(table_matches) * 100
        if table_matches else 100
    )

    # Calculate overall weighted score
    overall_score = (
        weights["detection_rate"] * detection_rate +
        weights["precision_rate"] * precision_rate +
        weights["avg_iou"] * avg_iou +
        weights["type_accuracy"] * type_accuracy +
        weights["label_accuracy"] * label_accuracy
    )

    return ExtractionScore(
        detection_rate=detection_rate,
        precision_rate=precision_rate,
        avg_iou=avg_iou,
        iou_distribution=iou_distribution,
        type_accuracy=type_accuracy,
        type_confusion=type_confusion,
        label_accuracy=label_accuracy,
        table_detection=table_detection,
        table_cell_accuracy=table_cell_accuracy,
        matched_fields=matched,
        missed_fields=missed,
        extra_fields=extra,
        overall_score=overall_score
    )
