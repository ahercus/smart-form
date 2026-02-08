"""
Image processor for quadrant-based field extraction.
Replicates the TypeScript implementation from src/lib/image-compositor.ts
"""

import io
import base64
from dataclasses import dataclass
from typing import Literal

from PIL import Image
from pdf2image import convert_from_path


QuadrantNumber = Literal[1, 2, 3, 4]


@dataclass
class QuadrantBounds:
    """Quadrant bounds as percentages (0-100)."""
    top: float
    left: float
    bottom: float
    right: float


@dataclass
class ProcessedImage:
    """Result of image processing."""
    image_base64: str
    width: int
    height: int


QUADRANT_BOUNDS: dict[QuadrantNumber, QuadrantBounds] = {
    1: QuadrantBounds(top=0, left=0, bottom=25, right=100),
    2: QuadrantBounds(top=25, left=0, bottom=50, right=100),
    3: QuadrantBounds(top=50, left=0, bottom=75, right=100),
    4: QuadrantBounds(top=75, left=0, bottom=100, right=100),
}


def get_quadrant_bounds(quadrant: QuadrantNumber) -> QuadrantBounds:
    """Get the bounds for a quadrant number (vertical quarters)."""
    return QUADRANT_BOUNDS[quadrant]


def pdf_page_to_image(pdf_path: str, page_number: int = 0, dpi: int = 150) -> Image.Image:
    """
    Convert a PDF page to PIL Image.

    Args:
        pdf_path: Path to PDF file
        page_number: 0-indexed page number
        dpi: Resolution for conversion

    Returns:
        PIL Image of the page
    """
    images = convert_from_path(
        pdf_path,
        dpi=dpi,
        first_page=page_number + 1,
        last_page=page_number + 1
    )
    if not images:
        raise ValueError(f"Could not convert page {page_number + 1} from PDF")
    return images[0]


def resize_for_gemini(
    image: Image.Image,
    max_width: int = 1600
) -> ProcessedImage:
    """
    Resize image for Gemini Vision to reduce payload size.

    Based on partner prototype learnings:
    - Max 1600px width reduces upload time on mobile networks
    - Maintains aspect ratio
    - Uses high quality (85) to preserve lines and text edges for OCR

    Args:
        image: PIL Image to resize
        max_width: Maximum width in pixels (default 1600)

    Returns:
        ProcessedImage with base64 encoded JPEG
    """
    width, height = image.size

    # If image is already small enough, convert to JPEG and return
    if width <= max_width:
        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="JPEG", quality=85)
        return ProcessedImage(
            image_base64=base64.b64encode(buffer.getvalue()).decode("utf-8"),
            width=width,
            height=height
        )

    # Calculate new dimensions maintaining aspect ratio
    ratio = max_width / width
    new_height = int(height * ratio)

    # Resize with high quality settings for OCR accuracy
    resized = image.resize((max_width, new_height), Image.Resampling.LANCZOS)

    buffer = io.BytesIO()
    resized.convert("RGB").save(buffer, format="JPEG", quality=85)

    return ProcessedImage(
        image_base64=base64.b64encode(buffer.getvalue()).decode("utf-8"),
        width=max_width,
        height=new_height
    )


def create_quadrant_overlay_svg(
    width: int,
    height: int,
    quadrant: QuadrantNumber,
    overlay_color: str = "#8B5CF6",
    overlay_opacity: float = 0.25
) -> str:
    """
    Create SVG overlay with ruler-style margins and highlighted quadrant region.

    Rulers have notches every 2% and labels every 10% on all 4 sides.

    Matches TypeScript implementation exactly:
    - Ruler width: 28px
    - Notch spacing: 2%
    - Label spacing: 10%
    - Purple highlight with 25% opacity
    - 3px stroke around quadrant

    Args:
        width: Image width in pixels
        height: Image height in pixels
        quadrant: Which quadrant to highlight (1-4)
        overlay_color: Color for quadrant highlight (default purple)
        overlay_opacity: Opacity of fill (default 0.25)

    Returns:
        SVG string
    """
    bounds = get_quadrant_bounds(quadrant)
    ruler_width = 28
    notch_spacing = 2
    label_spacing = 10
    ruler_color = "#1e40af"  # Dark blue

    svg_parts = [f'<svg width="{width}" height="{height}" xmlns="http://www.w3.org/2000/svg">']

    # Draw the purple quadrant highlight
    qx = (bounds.left / 100) * width
    qy = (bounds.top / 100) * height
    qw = ((bounds.right - bounds.left) / 100) * width
    qh = ((bounds.bottom - bounds.top) / 100) * height

    svg_parts.append(
        f'<rect x="{qx}" y="{qy}" width="{qw}" height="{qh}" '
        f'fill="{overlay_color}" opacity="{overlay_opacity}" />'
    )
    svg_parts.append(
        f'<rect x="{qx}" y="{qy}" width="{qw}" height="{qh}" '
        f'fill="none" stroke="{overlay_color}" stroke-width="3" opacity="0.8" />'
    )

    # === LEFT RULER (Y axis - vertical %) ===
    svg_parts.append(
        f'<rect x="0" y="0" width="{ruler_width}" height="{height}" fill="white" opacity="0.95"/>'
    )
    svg_parts.append(
        f'<line x1="{ruler_width}" y1="0" x2="{ruler_width}" y2="{height}" '
        f'stroke="{ruler_color}" stroke-width="1"/>'
    )

    for y in range(0, 101, notch_spacing):
        py = (y / 100) * height
        is_major = y % 10 == 0
        notch_length = 10 if is_major else 5
        stroke_width = 1.5 if is_major else 0.5
        svg_parts.append(
            f'<line x1="{ruler_width - notch_length}" y1="{py}" '
            f'x2="{ruler_width}" y2="{py}" '
            f'stroke="{ruler_color}" stroke-width="{stroke_width}"/>'
        )

        if y % label_spacing == 0:
            font_size = 11 if y % 25 == 0 else 9
            font_weight = "bold" if y % 25 == 0 else "normal"
            svg_parts.append(
                f'<text x="2" y="{py + 4}" font-size="{font_size}" '
                f'font-weight="{font_weight}" font-family="Arial" fill="{ruler_color}">{y}</text>'
            )

    # === RIGHT RULER (Y axis - vertical %) ===
    svg_parts.append(
        f'<rect x="{width - ruler_width}" y="0" width="{ruler_width}" height="{height}" '
        f'fill="white" opacity="0.95"/>'
    )
    svg_parts.append(
        f'<line x1="{width - ruler_width}" y1="0" x2="{width - ruler_width}" y2="{height}" '
        f'stroke="{ruler_color}" stroke-width="1"/>'
    )

    for y in range(0, 101, notch_spacing):
        py = (y / 100) * height
        is_major = y % 10 == 0
        notch_length = 10 if is_major else 5
        stroke_width = 1.5 if is_major else 0.5
        svg_parts.append(
            f'<line x1="{width - ruler_width}" y1="{py}" '
            f'x2="{width - ruler_width + notch_length}" y2="{py}" '
            f'stroke="{ruler_color}" stroke-width="{stroke_width}"/>'
        )

        if y % label_spacing == 0:
            font_size = 11 if y % 25 == 0 else 9
            font_weight = "bold" if y % 25 == 0 else "normal"
            svg_parts.append(
                f'<text x="{width - ruler_width + 12}" y="{py + 4}" font-size="{font_size}" '
                f'font-weight="{font_weight}" font-family="Arial" fill="{ruler_color}">{y}</text>'
            )

    # === TOP RULER (X axis - horizontal %) ===
    svg_parts.append(
        f'<rect x="0" y="0" width="{width}" height="{ruler_width}" fill="white" opacity="0.95"/>'
    )
    svg_parts.append(
        f'<line x1="0" y1="{ruler_width}" x2="{width}" y2="{ruler_width}" '
        f'stroke="{ruler_color}" stroke-width="1"/>'
    )

    for x in range(0, 101, notch_spacing):
        px = (x / 100) * width
        is_major = x % 10 == 0
        notch_length = 10 if is_major else 5
        stroke_width = 1.5 if is_major else 0.5
        svg_parts.append(
            f'<line x1="{px}" y1="{ruler_width - notch_length}" '
            f'x2="{px}" y2="{ruler_width}" '
            f'stroke="{ruler_color}" stroke-width="{stroke_width}"/>'
        )

        if x % label_spacing == 0 and x > 0:
            font_size = 11 if x % 25 == 0 else 9
            font_weight = "bold" if x % 25 == 0 else "normal"
            svg_parts.append(
                f'<text x="{px - 6}" y="12" font-size="{font_size}" '
                f'font-weight="{font_weight}" font-family="Arial" fill="{ruler_color}">{x}</text>'
            )

    # === BOTTOM RULER (X axis - horizontal %) ===
    svg_parts.append(
        f'<rect x="0" y="{height - ruler_width}" width="{width}" height="{ruler_width}" '
        f'fill="white" opacity="0.95"/>'
    )
    svg_parts.append(
        f'<line x1="0" y1="{height - ruler_width}" x2="{width}" y2="{height - ruler_width}" '
        f'stroke="{ruler_color}" stroke-width="1"/>'
    )

    for x in range(0, 101, notch_spacing):
        px = (x / 100) * width
        is_major = x % 10 == 0
        notch_length = 10 if is_major else 5
        stroke_width = 1.5 if is_major else 0.5
        svg_parts.append(
            f'<line x1="{px}" y1="{height - ruler_width}" '
            f'x2="{px}" y2="{height - ruler_width + notch_length}" '
            f'stroke="{ruler_color}" stroke-width="{stroke_width}"/>'
        )

        if x % label_spacing == 0 and x > 0:
            font_size = 11 if x % 25 == 0 else 9
            font_weight = "bold" if x % 25 == 0 else "normal"
            svg_parts.append(
                f'<text x="{px - 6}" y="{height - 6}" font-size="{font_size}" '
                f'font-weight="{font_weight}" font-family="Arial" fill="{ruler_color}">{x}</text>'
            )

    svg_parts.append('</svg>')
    return '\n'.join(svg_parts)


def create_rulers_only_svg(
    width: int,
    height: int
) -> str:
    """
    Create SVG overlay with ruler-style margins but no quadrant highlight.
    Used for single-page-with-rulers mode.

    Args:
        width: Image width in pixels
        height: Image height in pixels

    Returns:
        SVG string with rulers on all 4 sides
    """
    ruler_width = 28
    notch_spacing = 2
    label_spacing = 10
    ruler_color = "#1e40af"  # Dark blue

    svg_parts = [f'<svg width="{width}" height="{height}" xmlns="http://www.w3.org/2000/svg">']

    # === LEFT RULER (Y axis - vertical %) ===
    svg_parts.append(
        f'<rect x="0" y="0" width="{ruler_width}" height="{height}" fill="white" opacity="0.95"/>'
    )
    svg_parts.append(
        f'<line x1="{ruler_width}" y1="0" x2="{ruler_width}" y2="{height}" '
        f'stroke="{ruler_color}" stroke-width="1"/>'
    )

    for y in range(0, 101, notch_spacing):
        py = (y / 100) * height
        is_major = y % 10 == 0
        notch_length = 10 if is_major else 5
        stroke_width = 1.5 if is_major else 0.5
        svg_parts.append(
            f'<line x1="{ruler_width - notch_length}" y1="{py}" '
            f'x2="{ruler_width}" y2="{py}" '
            f'stroke="{ruler_color}" stroke-width="{stroke_width}"/>'
        )

        if y % label_spacing == 0:
            font_size = 11 if y % 25 == 0 else 9
            font_weight = "bold" if y % 25 == 0 else "normal"
            svg_parts.append(
                f'<text x="2" y="{py + 4}" font-size="{font_size}" '
                f'font-weight="{font_weight}" font-family="Arial" fill="{ruler_color}">{y}</text>'
            )

    # === RIGHT RULER (Y axis - vertical %) ===
    svg_parts.append(
        f'<rect x="{width - ruler_width}" y="0" width="{ruler_width}" height="{height}" '
        f'fill="white" opacity="0.95"/>'
    )
    svg_parts.append(
        f'<line x1="{width - ruler_width}" y1="0" x2="{width - ruler_width}" y2="{height}" '
        f'stroke="{ruler_color}" stroke-width="1"/>'
    )

    for y in range(0, 101, notch_spacing):
        py = (y / 100) * height
        is_major = y % 10 == 0
        notch_length = 10 if is_major else 5
        stroke_width = 1.5 if is_major else 0.5
        svg_parts.append(
            f'<line x1="{width - ruler_width}" y1="{py}" '
            f'x2="{width - ruler_width + notch_length}" y2="{py}" '
            f'stroke="{ruler_color}" stroke-width="{stroke_width}"/>'
        )

        if y % label_spacing == 0:
            font_size = 11 if y % 25 == 0 else 9
            font_weight = "bold" if y % 25 == 0 else "normal"
            svg_parts.append(
                f'<text x="{width - ruler_width + 12}" y="{py + 4}" font-size="{font_size}" '
                f'font-weight="{font_weight}" font-family="Arial" fill="{ruler_color}">{y}</text>'
            )

    # === TOP RULER (X axis - horizontal %) ===
    svg_parts.append(
        f'<rect x="0" y="0" width="{width}" height="{ruler_width}" fill="white" opacity="0.95"/>'
    )
    svg_parts.append(
        f'<line x1="0" y1="{ruler_width}" x2="{width}" y2="{ruler_width}" '
        f'stroke="{ruler_color}" stroke-width="1"/>'
    )

    for x in range(0, 101, notch_spacing):
        px = (x / 100) * width
        is_major = x % 10 == 0
        notch_length = 10 if is_major else 5
        stroke_width = 1.5 if is_major else 0.5
        svg_parts.append(
            f'<line x1="{px}" y1="{ruler_width - notch_length}" '
            f'x2="{px}" y2="{ruler_width}" '
            f'stroke="{ruler_color}" stroke-width="{stroke_width}"/>'
        )

        if x % label_spacing == 0 and x > 0:
            font_size = 11 if x % 25 == 0 else 9
            font_weight = "bold" if x % 25 == 0 else "normal"
            svg_parts.append(
                f'<text x="{px - 6}" y="12" font-size="{font_size}" '
                f'font-weight="{font_weight}" font-family="Arial" fill="{ruler_color}">{x}</text>'
            )

    # === BOTTOM RULER (X axis - horizontal %) ===
    svg_parts.append(
        f'<rect x="0" y="{height - ruler_width}" width="{width}" height="{ruler_width}" '
        f'fill="white" opacity="0.95"/>'
    )
    svg_parts.append(
        f'<line x1="0" y1="{height - ruler_width}" x2="{width}" y2="{height - ruler_width}" '
        f'stroke="{ruler_color}" stroke-width="1"/>'
    )

    for x in range(0, 101, notch_spacing):
        px = (x / 100) * width
        is_major = x % 10 == 0
        notch_length = 10 if is_major else 5
        stroke_width = 1.5 if is_major else 0.5
        svg_parts.append(
            f'<line x1="{px}" y1="{height - ruler_width}" '
            f'x2="{px}" y2="{height - ruler_width + notch_length}" '
            f'stroke="{ruler_color}" stroke-width="{stroke_width}"/>'
        )

        if x % label_spacing == 0 and x > 0:
            font_size = 11 if x % 25 == 0 else 9
            font_weight = "bold" if x % 25 == 0 else "normal"
            svg_parts.append(
                f'<text x="{px - 6}" y="{height - 6}" font-size="{font_size}" '
                f'font-weight="{font_weight}" font-family="Arial" fill="{ruler_color}">{x}</text>'
            )

    svg_parts.append('</svg>')
    return '\n'.join(svg_parts)


def composite_svg_onto_image(image: Image.Image, svg_string: str) -> Image.Image:
    """
    Composite an SVG overlay onto a PIL Image.

    Args:
        image: Base PIL Image
        svg_string: SVG overlay string

    Returns:
        Composited PIL Image
    """
    try:
        import cairosvg
        # Convert SVG to PNG using cairosvg
        png_data = cairosvg.svg2png(
            bytestring=svg_string.encode('utf-8'),
            output_width=image.width,
            output_height=image.height
        )
        overlay = Image.open(io.BytesIO(png_data)).convert("RGBA")
    except ImportError:
        # Fallback: use Pillow's SVG support if available, or skip overlay
        print("Warning: cairosvg not installed, using basic overlay")
        # Create a simple transparent overlay as fallback
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))

    # Composite overlay onto image
    result = image.convert("RGBA")
    result = Image.alpha_composite(result, overlay)
    return result.convert("RGB")


def composite_quadrant_overlay(
    image: Image.Image,
    quadrant: QuadrantNumber,
    overlay_color: str = "#8B5CF6",
    overlay_opacity: float = 0.25
) -> ProcessedImage:
    """
    Composite a quadrant overlay onto a full page image.

    Returns the FULL PAGE with rulers and highlighted quadrant region.
    Used for quadrant-based field extraction where each agent sees the full page
    but focuses on their assigned quadrant.

    Args:
        image: PIL Image of the full page
        quadrant: Which quadrant to highlight (1-4)
        overlay_color: Color for quadrant highlight (default purple)
        overlay_opacity: Opacity of fill (default 0.25)

    Returns:
        ProcessedImage with composited overlay as base64 JPEG
    """
    width, height = image.size

    # Create SVG overlay
    svg = create_quadrant_overlay_svg(
        width, height, quadrant,
        overlay_color, overlay_opacity
    )

    # Composite onto image
    result = composite_svg_onto_image(image, svg)

    # Convert to base64 JPEG
    buffer = io.BytesIO()
    result.save(buffer, format="JPEG", quality=85)

    return ProcessedImage(
        image_base64=base64.b64encode(buffer.getvalue()).decode("utf-8"),
        width=width,
        height=height
    )


def composite_rulers_only(image: Image.Image) -> ProcessedImage:
    """
    Composite rulers onto a full page image without quadrant highlight.
    Used for single-page-with-rulers mode.

    Args:
        image: PIL Image of the full page

    Returns:
        ProcessedImage with rulers overlay as base64 JPEG
    """
    width, height = image.size

    # Create SVG overlay
    svg = create_rulers_only_svg(width, height)

    # Composite onto image
    result = composite_svg_onto_image(image, svg)

    # Convert to base64 JPEG
    buffer = io.BytesIO()
    result.save(buffer, format="JPEG", quality=85)

    return ProcessedImage(
        image_base64=base64.b64encode(buffer.getvalue()).decode("utf-8"),
        width=width,
        height=height
    )


def image_to_base64(image: Image.Image, format: str = "JPEG", quality: int = 85) -> str:
    """
    Convert PIL Image to base64 string.

    Args:
        image: PIL Image
        format: Output format (JPEG or PNG)
        quality: JPEG quality (1-100)

    Returns:
        Base64 encoded string
    """
    buffer = io.BytesIO()
    if format.upper() == "JPEG":
        image.convert("RGB").save(buffer, format=format, quality=quality)
    else:
        image.save(buffer, format=format)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def base64_to_image(image_base64: str) -> Image.Image:
    """
    Convert base64 string to PIL Image.

    Args:
        image_base64: Base64 encoded image string

    Returns:
        PIL Image
    """
    image_data = base64.b64decode(image_base64)
    return Image.open(io.BytesIO(image_data))
