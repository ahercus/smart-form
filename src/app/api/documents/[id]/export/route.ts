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
      const y = height - ((coords.top / 100) * height) - ((coords.height / 100) * height * 0.7);
      const fieldWidth = (coords.width / 100) * width;
      const fieldHeight = (coords.height / 100) * height;

      // Calculate font size based on field height (use 70% of field height)
      let fontSize = Math.min(fieldHeight * 0.7, 12);
      fontSize = Math.max(fontSize, 6); // Minimum 6pt

      // Handle checkbox fields
      if (field.field_type === "checkbox") {
        if (field.value === "yes" || field.value === "true") {
          // Draw a checkmark
          page.drawText("✓", {
            x: x + fieldWidth * 0.3,
            y: y,
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
        y: y,
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
