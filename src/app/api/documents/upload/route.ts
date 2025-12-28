import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDocument } from "@/lib/storage";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

// Max dimension for images (Azure Document Intelligence has limits)
const MAX_IMAGE_DIMENSION = 2000;

async function resizeImageIfNeeded(imageBuffer: ArrayBuffer): Promise<{ buffer: Buffer; mimeType: string }> {
  const inputBuffer = Buffer.from(imageBuffer);

  // Get image metadata
  const metadata = await sharp(inputBuffer).metadata();
  const { width, height, orientation } = metadata;

  console.log("[AutoForm] Image metadata:", { width, height, format: metadata.format, orientation });

  // Check if resize is needed
  const needsResize = (width && width > MAX_IMAGE_DIMENSION) || (height && height > MAX_IMAGE_DIMENSION);

  if (needsResize) {
    console.log("[AutoForm] Resizing large image:", {
      originalWidth: width,
      originalHeight: height,
      maxDimension: MAX_IMAGE_DIMENSION,
      orientation
    });

    // Auto-rotate based on EXIF orientation, then resize
    // .rotate() without args uses EXIF orientation to correct rotation
    const resized = await sharp(inputBuffer)
      .rotate() // Auto-rotate based on EXIF orientation
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();

    const newMetadata = await sharp(resized).metadata();
    console.log("[AutoForm] Resized image:", {
      newWidth: newMetadata.width,
      newHeight: newMetadata.height,
      originalSize: inputBuffer.length,
      newSize: resized.length
    });

    return { buffer: resized, mimeType: "image/jpeg" };
  }

  // Convert non-JPEG/PNG formats to JPEG for pdf-lib compatibility
  // Also apply EXIF rotation for any image
  if (metadata.format !== "jpeg" && metadata.format !== "png") {
    console.log("[AutoForm] Converting image format:", { from: metadata.format, to: "jpeg" });
    const converted = await sharp(inputBuffer)
      .rotate() // Auto-rotate based on EXIF orientation
      .jpeg({ quality: 85 })
      .toBuffer();
    return { buffer: converted, mimeType: "image/jpeg" };
  }

  // Even for JPEG/PNG, apply EXIF rotation if needed
  if (orientation && orientation !== 1) {
    console.log("[AutoForm] Applying EXIF rotation:", { orientation });
    const rotated = await sharp(inputBuffer)
      .rotate() // Auto-rotate based on EXIF orientation
      .jpeg({ quality: 90 })
      .toBuffer();
    return { buffer: rotated, mimeType: "image/jpeg" };
  }

  return {
    buffer: inputBuffer,
    mimeType: metadata.format === "png" ? "image/png" : "image/jpeg"
  };
}

async function convertImageToPdf(imageBuffer: ArrayBuffer, originalMimeType: string): Promise<ArrayBuffer> {
  // Resize and normalize the image first
  const { buffer: processedBuffer, mimeType } = await resizeImageIfNeeded(imageBuffer);

  const pdfDoc = await PDFDocument.create();

  let image;
  if (mimeType === "image/jpeg") {
    image = await pdfDoc.embedJpg(processedBuffer);
  } else if (mimeType === "image/png") {
    image = await pdfDoc.embedPng(processedBuffer);
  } else {
    throw new Error(`Unsupported image format after processing: ${mimeType}`);
  }

  // Create a page with the image dimensions
  const page = pdfDoc.addPage([image.width, image.height]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  });

  const pdfBytes = await pdfDoc.save();
  // Convert Uint8Array to ArrayBuffer
  const buffer = new ArrayBuffer(pdfBytes.length);
  new Uint8Array(buffer).set(pdfBytes);
  return buffer;
}

export async function POST(request: NextRequest) {
  // Get authenticated user
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const contextNotes = formData.get("contextNotes") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Only PDF and image files (JPEG, PNG) are accepted" },
        { status: 400 }
      );
    }

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File size must be under 10MB" },
        { status: 400 }
      );
    }

    let fileData = await file.arrayBuffer();
    // Sanitize filename: replace spaces with underscores, remove special characters
    // This prevents "String did not match expected pattern" errors from Supabase storage
    let filename = file.name
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "");

    // Ensure filename isn't empty after sanitization
    if (!filename || filename === ".pdf") {
      filename = `document_${Date.now()}.pdf`;
    }

    // Convert images to PDF
    if (file.type !== "application/pdf") {
      console.log("[AutoForm] Converting image to PDF:", { originalType: file.type, originalFilename: file.name });
      fileData = await convertImageToPdf(fileData, file.type);
      filename = filename.replace(/\.(jpe?g|png|webp|gif|heic|heif)$/i, ".pdf");

      // If no extension was replaced (e.g., mobile camera photo), add .pdf
      if (!filename.endsWith(".pdf")) {
        filename = filename + ".pdf";
      }
    }

    const document = await createDocument(
      user.id,
      filename,
      fileData,
      contextNotes || undefined
    );

    console.log(`[AutoForm] Document uploaded:`, {
      id: document.id,
      filename: document.original_filename,
      size: document.file_size_bytes,
    });

    // Trigger processing asynchronously
    const baseUrl = request.nextUrl.origin;
    console.log("[AutoForm] Triggering document processing:", {
      documentId: document.id,
      baseUrl,
      processUrl: `${baseUrl}/api/documents/${document.id}/process`,
    });

    fetch(`${baseUrl}/api/documents/${document.id}/process`, {
      method: "POST",
      headers: {
        Cookie: request.headers.get("cookie") || "",
      },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        console.log("[AutoForm] Process trigger response:", {
          documentId: document.id,
          status: res.status,
          ok: res.ok,
          data,
        });
      })
      .catch((err) => {
        console.error(`[AutoForm] Failed to trigger processing:`, {
          documentId: document.id,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      });

    return NextResponse.json({
      documentId: document.id,
      status: document.status,
      message: "Document received. Processing will begin shortly.",
    });
  } catch (error) {
    console.error(`[AutoForm] Upload failed:`, error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
