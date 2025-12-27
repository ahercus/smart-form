import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument, getFile } from "@/lib/storage";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ExtractedField } from "@/lib/types";

// GET /api/documents/[id]/export - Export filled PDF
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: documentId } = await params;

  try {
    const document = await getDocument(documentId);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Get the original PDF
    const pdfBuffer = await getFile(document.storage_path);

    // Get all fields with values
    const adminClient = createAdminClient();
    const { data: fields, error: fieldsError } = await adminClient
      .from("extracted_fields")
      .select("*")
      .eq("document_id", documentId)
      .is("deleted_at", null)
      .order("page_number")
      .order("field_index");

    if (fieldsError) {
      throw new Error(`Failed to get fields: ${fieldsError.message}`);
    }

    // Load the PDF
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pages = pdfDoc.getPages();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Draw field values onto the PDF
    for (const field of (fields || []) as ExtractedField[]) {
      if (!field.value) continue;

      const pageIndex = field.page_number - 1;
      if (pageIndex < 0 || pageIndex >= pages.length) continue;

      const page = pages[pageIndex];
      const { width, height } = page.getSize();

      // Convert normalized coordinates (percentages) to PDF points
      const coords = field.coordinates;
      const x = (coords.left / 100) * width;
      const fieldWidth = (coords.width / 100) * width;
      const fieldHeight = (coords.height / 100) * height;
      // Y position for PDF (bottom-up coordinate system)
      const y = height - ((coords.top / 100) * height) - fieldHeight;

      // Handle signature/initials fields (data URL images)
      if (
        (field.field_type === "signature" || field.field_type === "initials") &&
        field.value.startsWith("data:image")
      ) {
        try {
          // Extract base64 data from data URL
          const base64Match = field.value.match(/^data:image\/\w+;base64,(.+)$/);
          if (base64Match) {
            const base64Data = base64Match[1];
            const imageBytes = Buffer.from(base64Data, "base64");

            // Embed the PNG image
            const pngImage = await pdfDoc.embedPng(imageBytes);

            // Calculate dimensions to fit within field while maintaining aspect ratio
            const imageAspect = pngImage.width / pngImage.height;
            const fieldAspect = fieldWidth / fieldHeight;

            let drawWidth = fieldWidth;
            let drawHeight = fieldHeight;

            if (imageAspect > fieldAspect) {
              // Image is wider than field - fit to width
              drawHeight = fieldWidth / imageAspect;
            } else {
              // Image is taller than field - fit to height
              drawWidth = fieldHeight * imageAspect;
            }

            // Center the image within the field
            const offsetX = (fieldWidth - drawWidth) / 2;
            const offsetY = (fieldHeight - drawHeight) / 2;

            page.drawImage(pngImage, {
              x: x + offsetX,
              y: y + offsetY,
              width: drawWidth,
              height: drawHeight,
            });
          }
        } catch (imgError) {
          console.error("[AutoForm] Failed to embed signature image:", imgError);
          // Fall through to text rendering as fallback
        }
        continue;
      }

      // Calculate font size based on field height (use 70% of field height)
      let fontSize = Math.min(fieldHeight * 0.7, 12);
      fontSize = Math.max(fontSize, 6); // Minimum 6pt

      // Adjust Y for text (add offset for baseline)
      const textY = y + fieldHeight * 0.3;

      // Handle checkbox fields
      if (field.field_type === "checkbox") {
        if (field.value === "yes" || field.value === "true") {
          // Draw a checkmark
          page.drawText("✓", {
            x: x + fieldWidth * 0.3,
            y: textY,
            size: fontSize * 1.2,
            font,
            color: rgb(0, 0, 0),
          });
        }
        continue;
      }

      // Draw text value
      const text = field.value;

      // Truncate text if it's too long for the field
      let displayText = text;
      const maxWidth = fieldWidth - 4; // Small padding
      let textWidth = font.widthOfTextAtSize(displayText, fontSize);

      while (textWidth > maxWidth && displayText.length > 0) {
        displayText = displayText.slice(0, -1);
        textWidth = font.widthOfTextAtSize(displayText + "...", fontSize);
      }

      if (displayText !== text) {
        displayText += "...";
      }

      page.drawText(displayText, {
        x: x + 2, // Small left padding
        y: textY,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }

    // Save the filled PDF
    const filledPdfBytes = await pdfDoc.save();

    // Return as downloadable PDF
    const filename = document.original_filename.replace(/\.pdf$/i, "") + "_filled.pdf";

    return new Response(Buffer.from(filledPdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("[AutoForm] Export PDF error:", error);
    return NextResponse.json(
      { error: "Failed to export PDF" },
      { status: 500 }
    );
  }
}
