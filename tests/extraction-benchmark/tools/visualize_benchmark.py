#!/usr/bin/env python3
"""
Visualization tool for rendering benchmark fields onto PDF page images.
Used to visually verify field coordinates and compare extraction results.
"""

import json
import sys
from pathlib import Path
from typing import Optional

from pdf2image import convert_from_path
from PIL import Image, ImageDraw, ImageFont


# Color scheme by field type (matching the TS implementation)
FIELD_COLORS = {
    "text": "#3b82f6",       # blue
    "textarea": "#8b5cf6",   # purple
    "date": "#f59e0b",       # amber
    "linkedDate": "#f59e0b", # amber
    "checkbox": "#10b981",   # green
    "radio": "#06b6d4",      # cyan
    "signature": "#ef4444",  # red
    "initials": "#ec4899",   # pink
    "table": "#0ea5e9",      # sky blue
    "linkedText": "#a855f7", # violet
    "unknown": "#6b7280",    # gray
}


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def hex_to_rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    """Convert hex color to RGBA tuple."""
    r, g, b = hex_to_rgb(hex_color)
    return (r, g, b, alpha)


def render_fields_on_image(
    image: Image.Image,
    fields: list[dict],
    show_labels: bool = True,
    fill_opacity: int = 50,  # 0-255
    stroke_width: int = 2
) -> Image.Image:
    """
    Render field rectangles onto an image.

    Args:
        image: PIL Image to draw on
        fields: List of field dicts with coordinates
        show_labels: Whether to show field labels
        fill_opacity: Opacity of fill (0-255)
        stroke_width: Width of border stroke

    Returns:
        Image with fields drawn on it
    """
    # Create a copy to avoid modifying original
    result = image.copy().convert("RGBA")
    width, height = result.size

    # Create overlay for semi-transparent fills
    overlay = Image.new("RGBA", result.size, (255, 255, 255, 0))
    draw_overlay = ImageDraw.Draw(overlay)

    # Create draw object for strokes and text
    draw = ImageDraw.Draw(result)

    # Try to load a font, fall back to default
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 12)
        font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 10)
    except:
        font = ImageFont.load_default()
        font_small = font

    for field in fields:
        field_type = field.get("fieldType", field.get("type", "unknown")).lower()
        color = FIELD_COLORS.get(field_type, FIELD_COLORS["unknown"])
        label = field.get("label", "")

        # Get coordinates
        coords = field.get("coordinates", field.get("box", {}))
        if not coords:
            # Check for special types with segments
            if "dateSegments" in field:
                # Draw each date segment
                for seg in field["dateSegments"]:
                    _draw_rect(
                        draw_overlay, draw, width, height,
                        seg, color, fill_opacity, stroke_width,
                        f"{label} ({seg.get('part', '')})" if show_labels else None,
                        font_small
                    )
                continue
            elif "segments" in field:
                # Draw each linkedText segment
                for i, seg in enumerate(field["segments"]):
                    _draw_rect(
                        draw_overlay, draw, width, height,
                        seg, color, fill_opacity, stroke_width,
                        f"{label} (seg {i+1})" if show_labels else None,
                        font_small
                    )
                continue
            elif "tableConfig" in field:
                # Draw table boundary and cells
                table_config = field["tableConfig"]
                table_coords = table_config.get("coordinates", {})
                _draw_table(
                    draw_overlay, draw, width, height,
                    table_coords, table_config, color, fill_opacity, stroke_width,
                    label if show_labels else None, font, font_small
                )
                continue
            else:
                continue

        _draw_rect(
            draw_overlay, draw, width, height,
            coords, color, fill_opacity, stroke_width,
            label if show_labels else None, font
        )

    # Composite overlay onto result
    result = Image.alpha_composite(result, overlay)

    return result.convert("RGB")


def _draw_rect(
    draw_overlay: ImageDraw.ImageDraw,
    draw: ImageDraw.ImageDraw,
    img_width: int,
    img_height: int,
    coords: dict,
    color: str,
    fill_opacity: int,
    stroke_width: int,
    label: Optional[str],
    font
):
    """Draw a single rectangle with optional label."""
    # Convert percentage coordinates to pixels
    # Support both left/top and x/y naming conventions
    left_pct = coords.get("left", coords.get("x", 0))
    top_pct = coords.get("top", coords.get("y", 0))
    width_pct = coords.get("width", 0)
    height_pct = coords.get("height", 0)

    x1 = int((left_pct / 100) * img_width)
    y1 = int((top_pct / 100) * img_height)
    x2 = int(((left_pct + width_pct) / 100) * img_width)
    y2 = int(((top_pct + height_pct) / 100) * img_height)

    # Draw semi-transparent fill
    fill_color = hex_to_rgba(color, fill_opacity)
    draw_overlay.rectangle([x1, y1, x2, y2], fill=fill_color)

    # Draw border stroke
    stroke_color = hex_to_rgb(color)
    draw.rectangle([x1, y1, x2, y2], outline=stroke_color, width=stroke_width)

    # Draw label above the box
    if label:
        # White background for readability
        text_bbox = draw.textbbox((x1, y1 - 15), label, font=font)
        draw.rectangle(
            [text_bbox[0] - 2, text_bbox[1] - 1, text_bbox[2] + 2, text_bbox[3] + 1],
            fill=(255, 255, 255, 200)
        )
        draw.text((x1, y1 - 15), label, fill=stroke_color, font=font)


def _draw_table(
    draw_overlay: ImageDraw.ImageDraw,
    draw: ImageDraw.ImageDraw,
    img_width: int,
    img_height: int,
    coords: dict,
    table_config: dict,
    color: str,
    fill_opacity: int,
    stroke_width: int,
    label: Optional[str],
    font,
    font_small
):
    """Draw a table with cell grid."""
    # Convert percentage coordinates to pixels
    left_pct = coords.get("left", 0)
    top_pct = coords.get("top", 0)
    width_pct = coords.get("width", 0)
    height_pct = coords.get("height", 0)

    x1 = int((left_pct / 100) * img_width)
    y1 = int((top_pct / 100) * img_height)
    x2 = int(((left_pct + width_pct) / 100) * img_width)
    y2 = int(((top_pct + height_pct) / 100) * img_height)

    table_width = x2 - x1
    table_height = y2 - y1

    # Draw table boundary
    fill_color = hex_to_rgba(color, fill_opacity // 2)
    draw_overlay.rectangle([x1, y1, x2, y2], fill=fill_color)
    stroke_color = hex_to_rgb(color)
    draw.rectangle([x1, y1, x2, y2], outline=stroke_color, width=stroke_width + 1)

    # Draw column lines
    column_headers = table_config.get("columnHeaders", [])
    column_positions = table_config.get("columnPositions", None)
    num_cols = len(column_headers)

    if column_positions:
        # Use specified positions
        for pos in column_positions[1:-1]:  # Skip 0 and 100
            col_x = x1 + int((pos / 100) * table_width)
            draw.line([(col_x, y1), (col_x, y2)], fill=stroke_color, width=1)
    elif num_cols > 0:
        # Uniform columns
        col_width = table_width / num_cols
        for i in range(1, num_cols):
            col_x = x1 + int(i * col_width)
            draw.line([(col_x, y1), (col_x, y2)], fill=stroke_color, width=1)

    # Draw row lines
    data_rows = table_config.get("dataRows", 1)
    row_heights = table_config.get("rowHeights", None)
    total_rows = data_rows + 1  # +1 for header

    if row_heights:
        # Use specified heights
        cumulative = 0
        for h in row_heights[:-1]:
            cumulative += h
            row_y = y1 + int((cumulative / 100) * table_height)
            draw.line([(x1, row_y), (x2, row_y)], fill=stroke_color, width=1)
    else:
        # Uniform rows
        row_height = table_height / total_rows
        for i in range(1, total_rows):
            row_y = y1 + int(i * row_height)
            draw.line([(x1, row_y), (x2, row_y)], fill=stroke_color, width=1)

    # Draw label above the table
    if label:
        text_bbox = draw.textbbox((x1, y1 - 18), label, font=font)
        draw.rectangle(
            [text_bbox[0] - 2, text_bbox[1] - 1, text_bbox[2] + 2, text_bbox[3] + 1],
            fill=(255, 255, 255, 200)
        )
        draw.text((x1, y1 - 18), label, fill=stroke_color, font=font)

    # Draw column headers
    if column_headers:
        if column_positions:
            for i, header in enumerate(column_headers):
                col_start = column_positions[i] if i < len(column_positions) else 0
                col_end = column_positions[i + 1] if i + 1 < len(column_positions) else 100
                col_x = x1 + int(((col_start + col_end) / 2 / 100) * table_width) - 20
                draw.text((col_x, y1 + 2), header[:10], fill=(100, 100, 100), font=font_small)
        else:
            col_width = table_width / num_cols
            for i, header in enumerate(column_headers):
                col_x = x1 + int((i + 0.5) * col_width) - 20
                draw.text((col_x, y1 + 2), header[:10], fill=(100, 100, 100), font=font_small)


def render_benchmark(
    pdf_path: str,
    benchmark_json_path: str,
    output_png_path: str,
    page_number: int = 0,
    dpi: int = 150
):
    """
    Render benchmark fields onto a PDF page.

    Args:
        pdf_path: Path to the PDF file
        benchmark_json_path: Path to the benchmark JSON file
        output_png_path: Path to save the output PNG
        page_number: Which page to render (0-indexed)
        dpi: DPI for PDF conversion
    """
    # Convert PDF page to image
    print(f"Converting PDF page {page_number + 1} to image...")
    images = convert_from_path(pdf_path, dpi=dpi, first_page=page_number + 1, last_page=page_number + 1)

    if not images:
        raise ValueError(f"Could not convert page {page_number + 1} from PDF")

    page_image = images[0]
    print(f"Page size: {page_image.size}")

    # Load benchmark JSON
    print(f"Loading benchmark from {benchmark_json_path}...")
    with open(benchmark_json_path, "r") as f:
        benchmark = json.load(f)

    fields = benchmark.get("fields", [])
    print(f"Found {len(fields)} fields to render")

    # Render fields onto image
    result = render_fields_on_image(page_image, fields)

    # Save result
    output_path = Path(output_png_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result.save(output_png_path, "PNG")
    print(f"Saved visualization to {output_png_path}")


def render_extraction_result(
    pdf_path: str,
    extraction_json_path: str,
    output_png_path: str,
    page_number: int = 0,
    dpi: int = 150
):
    """
    Render extraction results (from a test run) onto a PDF page.
    Same as render_benchmark but for test outputs.
    """
    render_benchmark(pdf_path, extraction_json_path, output_png_path, page_number, dpi)


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python visualize_benchmark.py <pdf_path> <benchmark_json> <output_png>")
        print("Example: python visualize_benchmark.py doc.pdf benchmark.json output.png")
        sys.exit(1)

    pdf_path = sys.argv[1]
    benchmark_json = sys.argv[2]
    output_png = sys.argv[3]

    render_benchmark(pdf_path, benchmark_json, output_png)
