import sharp from "sharp";

interface PreprocessResult {
  buffer: Buffer;
  mimeType: string;
  meta: {
    width?: number;
    height?: number;
    source: "external" | "local";
  };
}

interface PreprocessOptions {
  maxDimension: number;
  sourceMimeType: string;
}

async function tryExternalPreprocessor(
  inputBuffer: Buffer,
  sourceMimeType: string
): Promise<PreprocessResult | null> {
  const url = process.env.DOC_PREPROCESSOR_URL;
  if (!url) return null;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: inputBuffer.toString("base64"),
        mimeType: sourceMimeType,
      }),
    });

    if (!response.ok) {
      console.warn("[AutoForm] External preprocessor failed:", {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const payload = await response.json();
    if (!payload?.imageBase64 || !payload?.mimeType) {
      console.warn("[AutoForm] External preprocessor response missing fields");
      return null;
    }

    const buffer = Buffer.from(payload.imageBase64, "base64");
    const metadata = await sharp(buffer).metadata();

    return {
      buffer,
      mimeType: payload.mimeType,
      meta: {
        width: metadata.width,
        height: metadata.height,
        source: "external",
      },
    };
  } catch (error) {
    console.warn("[AutoForm] External preprocessor error:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

async function preprocessWithSharp(
  inputBuffer: Buffer,
  options: PreprocessOptions
): Promise<PreprocessResult> {
  const metadata = await sharp(inputBuffer).metadata();
  const { width, height, orientation } = metadata;

  console.log("[AutoForm] Image metadata:", {
    width,
    height,
    format: metadata.format,
    orientation,
  });

  const needsResize =
    (width && width > options.maxDimension) ||
    (height && height > options.maxDimension);

  let pipeline = sharp(inputBuffer).rotate();

  if (needsResize) {
    console.log("[AutoForm] Resizing large image:", {
      originalWidth: width,
      originalHeight: height,
      maxDimension: options.maxDimension,
      orientation,
    });

    pipeline = pipeline.resize(options.maxDimension, options.maxDimension, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const output = await pipeline.jpeg({ quality: 85 }).toBuffer();
  const newMetadata = await sharp(output).metadata();

  return {
    buffer: output,
    mimeType: "image/jpeg",
    meta: {
      width: newMetadata.width,
      height: newMetadata.height,
      source: "local",
    },
  };
}

export async function preprocessImageForOCR(
  imageBuffer: ArrayBuffer,
  options: PreprocessOptions
): Promise<PreprocessResult> {
  const inputBuffer = Buffer.from(imageBuffer);

  const external = await tryExternalPreprocessor(inputBuffer, options.sourceMimeType);
  if (external) {
    console.log("[AutoForm] External preprocessor applied:", external.meta);
    return external;
  }

  const local = await preprocessWithSharp(inputBuffer, options);
  console.log("[AutoForm] Local preprocessing applied:", local.meta);
  return local;
}
