import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument, getFile } from "@/lib/storage";
import { PDFDocument } from "pdf-lib";

// GET /api/documents/[id]/dimensions - Get PDF page dimensions
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

    // Get the PDF and extract page dimensions
    const pdfBuffer = await getFile(document.storage_path);
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pages = pdfDoc.getPages();

    // Get dimensions for each page (usually all the same, but handle multi-size PDFs)
    const dimensions = pages.map((page, index) => {
      const { width, height } = page.getSize();
      return {
        pageNumber: index + 1,
        width,
        height,
      };
    });

    return NextResponse.json({ dimensions });
  } catch (error) {
    console.error("[AutoForm] Get PDF dimensions error:", error);
    return NextResponse.json(
      { error: "Failed to get PDF dimensions" },
      { status: 500 }
    );
  }
}
