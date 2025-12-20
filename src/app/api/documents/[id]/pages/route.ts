import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getDocument,
  uploadPageImage,
  updateDocumentPageImages,
  getPageImageBase64,
} from "@/lib/storage";
import { generateQuestions } from "@/lib/orchestrator/question-generator";

// POST /api/documents/[id]/pages - Upload page images and trigger question generation
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

    const body = await request.json();
    const { pages } = body as {
      pages: Array<{ pageNumber: number; imageData: string }>;
    };

    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return NextResponse.json(
        { error: "pages array is required" },
        { status: 400 }
      );
    }

    console.log("[AutoForm] Uploading page images:", {
      documentId,
      pageCount: pages.length,
    });

    // Upload each page image to storage
    const uploadedPages: Array<{ page: number; storage_path: string }> = [];

    for (const page of pages) {
      // Remove data URL prefix if present
      let imageData = page.imageData;
      if (imageData.startsWith("data:")) {
        imageData = imageData.split(",")[1];
      }

      const buffer = Buffer.from(imageData, "base64");
      // Convert Buffer to ArrayBuffer
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );
      const storagePath = await uploadPageImage(
        user.id,
        documentId,
        page.pageNumber,
        arrayBuffer
      );

      uploadedPages.push({
        page: page.pageNumber,
        storage_path: storagePath,
      });
    }

    // Update document with page images
    await updateDocumentPageImages(documentId, uploadedPages);

    console.log("[AutoForm] Page images uploaded:", {
      documentId,
      pages: uploadedPages.length,
    });

    // Check which pages need processing
    // A page needs processing if it has fields but those fields haven't been Gemini-reviewed
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const supabaseAdmin = createAdminClient();

    const uploadedPageNumbers = uploadedPages.map(p => p.page);

    // Get fields for uploaded pages that haven't been processed by Gemini
    const { data: unprocessedFields } = await supabaseAdmin
      .from("extracted_fields")
      .select("page_number")
      .eq("document_id", documentId)
      .in("page_number", uploadedPageNumbers)
      .or("detection_source.eq.azure_document_intelligence,detection_source.eq.document_ai")
      .is("deleted_at", null);

    // Find unique pages that need processing
    const pagesNeedingProcessing = [...new Set(unprocessedFields?.map(f => f.page_number) || [])];

    console.log("[AutoForm] Checking pages for processing:", {
      documentId,
      uploadedPages: uploadedPageNumbers,
      pagesNeedingProcessing,
    });

    if (pagesNeedingProcessing.length > 0) {
      console.log("[AutoForm] Triggering question generation for pages:", {
        documentId,
        pages: pagesNeedingProcessing,
      });

      // Filter to only pages that need processing
      const pagesToProcess = uploadedPages.filter(p => pagesNeedingProcessing.includes(p.page));

      // Prepare page images for question generator
      const pageImages = await Promise.all(
        pagesToProcess.map(async (p) => ({
          pageNumber: p.page,
          imageBase64: await getPageImageBase64(p.storage_path),
        }))
      );

      // Run question generation in the background
      // The client uses Realtime for updates
      generateQuestions({
        documentId,
        userId: user.id,
        pageImages,
      }).catch((error) => {
        console.error("[AutoForm] Question generation failed:", error);
      });

      return NextResponse.json({
        success: true,
        pagesUploaded: uploadedPages.length,
        processingStarted: true,
        pagesProcessing: pagesNeedingProcessing,
      });
    }

    return NextResponse.json({
      success: true,
      pagesUploaded: uploadedPages.length,
      processingStarted: false,
      message: "Pages uploaded, all already processed",
    });
  } catch (error) {
    console.error("[AutoForm] Page upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload page images" },
      { status: 500 }
    );
  }
}

// GET /api/documents/[id]/pages - Get page image URLs
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

    const pageImages = document.page_images || [];

    // Generate signed URLs for each page
    const { getPageImageUrl } = await import("@/lib/storage");
    const pagesWithUrls = await Promise.all(
      pageImages.map(async (p: { page: number; storage_path: string }) => ({
        page: p.page,
        url: await getPageImageUrl(p.storage_path).catch(() => null),
      }))
    );

    return NextResponse.json({ pages: pagesWithUrls });
  } catch (error) {
    console.error("[AutoForm] Get pages error:", error);
    return NextResponse.json(
      { error: "Failed to get page images" },
      { status: 500 }
    );
  }
}
