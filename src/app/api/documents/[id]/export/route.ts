import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument, getFile } from "@/lib/storage";
import { PDFDocument } from "pdf-lib";

interface PageOverlay {
  pageNumber: number;
  imageDataUrl: string;
  width: number;
  height: number;
}

// POST /api/documents/[id]/export - Export filled PDF with client-rendered overlays
export async function POST(
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

    // Parse request body for overlay images
    const body = await request.json();
    const overlays: PageOverlay[] = body.overlays || [];

    // Get the original PDF
    const pdfBuffer = await getFile(document.storage_path);

    // Load the PDF
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pages = pdfDoc.getPages();

    // Overlay each page's rendered image
    for (const overlay of overlays) {
      const pageIndex = overlay.pageNumber - 1;
      if (pageIndex < 0 || pageIndex >= pages.length) continue;

      const page = pages[pageIndex];
      const { width: pdfWidth, height: pdfHeight } = page.getSize();

      // Extract base64 data from data URL
      const base64Match = overlay.imageDataUrl.match(/^data:image\/png;base64,(.+)$/);
      if (!base64Match) {
        console.warn(`[AutoForm] Invalid overlay image for page ${overlay.pageNumber}`);
        continue;
      }

      const base64Data = base64Match[1];
      const imageBytes = Buffer.from(base64Data, "base64");

      // Embed the PNG overlay
      const pngImage = await pdfDoc.embedPng(imageBytes);

      // Draw the overlay to cover the entire page
      // The overlay was rendered at the same aspect ratio as the page
      page.drawImage(pngImage, {
        x: 0,
        y: 0,
        width: pdfWidth,
        height: pdfHeight,
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
