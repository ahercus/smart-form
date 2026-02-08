"""
Deduplicator for fields at quadrant boundaries.
Removes duplicate fields that appear in adjacent quadrants.
"""

from typing import Optional


def coordinates_match(
    coords1: dict,
    coords2: dict,
    tolerance: float = 3.0
) -> bool:
    """
    Check if two coordinate sets match within tolerance.

    Args:
        coords1: First coordinates dict
        coords2: Second coordinates dict
        tolerance: Maximum difference allowed (percentage points)

    Returns:
        True if coordinates match within tolerance
    """
    if not coords1 or not coords2:
        return False

    for key in ["left", "top", "width", "height"]:
        v1 = coords1.get(key, 0)
        v2 = coords2.get(key, 0)
        if abs(v1 - v2) > tolerance:
            return False

    return True


def labels_match(label1: str, label2: str) -> bool:
    """
    Check if two labels match (case-insensitive, normalized).

    Args:
        label1: First label
        label2: Second label

    Returns:
        True if labels match
    """
    if not label1 or not label2:
        return False

    # Normalize: lowercase, strip whitespace
    norm1 = label1.lower().strip()
    norm2 = label2.lower().strip()

    return norm1 == norm2


def fields_match(
    field1: dict,
    field2: dict,
    coord_tolerance: float = 3.0
) -> bool:
    """
    Check if two fields are duplicates.

    Matches if:
    - Labels match (case-insensitive)
    - Field types match
    - Coordinates match within tolerance

    Args:
        field1: First field dict
        field2: Second field dict
        coord_tolerance: Coordinate tolerance in percentage points

    Returns:
        True if fields are duplicates
    """
    # Check field type
    type1 = field1.get("fieldType", field1.get("type", "")).lower()
    type2 = field2.get("fieldType", field2.get("type", "")).lower()
    if type1 != type2:
        return False

    # Check labels
    if not labels_match(field1.get("label", ""), field2.get("label", "")):
        return False

    # Check coordinates
    coords1 = field1.get("coordinates", field1.get("box", {}))
    coords2 = field2.get("coordinates", field2.get("box", {}))

    return coordinates_match(coords1, coords2, coord_tolerance)


def deduplicate_boundary_fields(
    fields: list[dict],
    tolerance: float = 3.0
) -> list[dict]:
    """
    Remove duplicate fields from quadrant boundary overlap.

    When using quadrant-based extraction, fields near boundaries (25%, 50%, 75%)
    may be detected by adjacent quadrants. This function removes duplicates,
    keeping the version from the earlier quadrant.

    Args:
        fields: List of field dicts with optional "_quadrant" key
        tolerance: Coordinate tolerance in percentage points

    Returns:
        Deduplicated list of fields
    """
    if not fields:
        return []

    # Sort by quadrant (keep earlier quadrant's version)
    sorted_fields = sorted(
        fields,
        key=lambda f: f.get("_quadrant", 0)
    )

    deduplicated = []
    seen_indices = set()

    for i, field in enumerate(sorted_fields):
        if i in seen_indices:
            continue

        # Check if this field matches any later field
        for j in range(i + 1, len(sorted_fields)):
            if j in seen_indices:
                continue

            if fields_match(field, sorted_fields[j], tolerance):
                # Mark the later one as duplicate
                seen_indices.add(j)

        # Keep this field (remove internal quadrant marker)
        field_copy = {k: v for k, v in field.items() if not k.startswith("_")}
        deduplicated.append(field_copy)

    return deduplicated


def deduplicate_by_position(
    fields: list[dict],
    tolerance: float = 2.0
) -> list[dict]:
    """
    Remove fields that occupy the same position regardless of label.

    Useful for catching cases where the same box is detected with different labels.

    Args:
        fields: List of field dicts
        tolerance: Coordinate tolerance in percentage points

    Returns:
        Deduplicated list of fields (keeps first occurrence)
    """
    if not fields:
        return []

    deduplicated = []

    for field in fields:
        coords = field.get("coordinates", field.get("box", {}))
        if not coords:
            deduplicated.append(field)
            continue

        # Check if any existing field has matching coordinates
        is_duplicate = False
        for existing in deduplicated:
            existing_coords = existing.get("coordinates", existing.get("box", {}))
            if coordinates_match(coords, existing_coords, tolerance):
                is_duplicate = True
                break

        if not is_duplicate:
            deduplicated.append(field)

    return deduplicated
