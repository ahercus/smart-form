import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument, getPageImageBase64 } from "@/lib/storage";
import { refineFields } from "@/lib/orchestrator/field-refinement";

// POST /api/documents/[id]/refine-fields - Run Gemini QC on extracted fields
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

    // Check if already refined
    if (document.fields_qc_complete) {
      console.log("[AutoForm] Fields already QC'd, skipping:", { documentId });
      return NextResponse.json({
        success: true,
        message: "Fields already refined",
        cached: true,
      });
    }

    // Get page images
    const pageImages = document.page_images || [];
    if (pageImages.length === 0) {
      console.log("[AutoForm] No page images available for refinement:", { documentId });
      return NextResponse.json({
        success: false,
        error: "No page images available",
      }, { status: 400 });
    }

    // Load page images as base64
    const pageImagesWithData = await Promise.all(
      pageImages.map(async (p: { page: number; storage_path: string }) => ({
        pageNumber: p.page,
        imageBase64: await getPageImageBase64(p.storage_path).catch(() => ""),
      }))
    );

    // Filter out pages without images
    const validPageImages = pageImagesWithData.filter((p) => p.imageBase64);

    if (validPageImages.length === 0) {
      console.log("[AutoForm] No valid page images for refinement:", { documentId });
      return NextResponse.json({
        success: false,
        error: "Failed to load page images",
      }, { status: 500 });
    }

    console.log("[AutoForm] Starting field refinement:", {
      documentId,
      pageCount: validPageImages.length,
    });

    // Run field refinement
    const result = await refineFields({
      documentId,
      userId: user.id,
      pageImages: validPageImages,
    });

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: result.error,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      fieldsAdjusted: result.fieldsAdjusted,
      fieldsAdded: result.fieldsAdded,
      fieldsRemoved: result.fieldsRemoved,
    });
  } catch (error) {
    console.error("[AutoForm] Refine fields error:", error);
    return NextResponse.json(
      { error: "Failed to refine fields" },
      { status: 500 }
    );
  }
}
