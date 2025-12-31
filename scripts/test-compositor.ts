// Test script to visualize the composite grid
// Run with: npx tsx scripts/test-compositor.ts

import { compositeFieldsOntoImage } from "../src/lib/image-compositor";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

async function main() {
  const pdfPath = path.join(__dirname, "../docs/tests/Golf_Application_Form_JNRSHARKS_2025.pdf");
  const outputDir = path.join(__dirname, "../docs/tests/output");

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Convert PDF to PNG using pdftoppm (if available) or sips (macOS)
  const tempPngPath = path.join(outputDir, "page-1.png");

  try {
    // Try pdftoppm first
    await execAsync(`pdftoppm -png -f 1 -l 1 -r 150 "${pdfPath}" "${outputDir}/page"`);
    // pdftoppm adds -1 suffix
    if (fs.existsSync(`${outputDir}/page-1.png`)) {
      console.log("Converted PDF to PNG using pdftoppm");
    }
  } catch {
    // Fall back to sips (macOS) - but sips doesn't do PDF well
    // Try using ImageMagick's convert
    try {
      await execAsync(`convert -density 150 "${pdfPath}[0]" "${tempPngPath}"`);
      console.log("Converted PDF to PNG using ImageMagick");
    } catch {
      console.error("Could not convert PDF. Install pdftoppm (brew install poppler) or ImageMagick");
      process.exit(1);
    }
  }

  // Read the page image
  const pageImagePath = fs.existsSync(`${outputDir}/page-1.png`)
    ? `${outputDir}/page-1.png`
    : tempPngPath;

  const pageImageBuffer = fs.readFileSync(pageImagePath);
  const pageImageBase64 = pageImageBuffer.toString("base64");

  // Create some mock fields to show the overlay
  const mockFields = [
    {
      id: "field-1",
      label: "NAME:",
      field_type: "text",
      coordinates: { left: 17, top: 29, width: 40, height: 3 },
    },
    {
      id: "field-2",
      label: "DATE OF BIRTH:",
      field_type: "date",
      coordinates: { left: 17, top: 33, width: 30, height: 3 },
    },
    {
      id: "field-3",
      label: "ADDRESS:",
      field_type: "text",
      coordinates: { left: 17, top: 37, width: 60, height: 3 },
    },
  ] as any;

  console.log("Creating composite image with grid...");

  // Test with grid only (no fields)
  const gridOnly = await compositeFieldsOntoImage({
    imageBase64: pageImageBase64,
    fields: [],
    showGrid: true,
    gridSpacing: 10,
  });

  const gridOnlyPath = path.join(outputDir, "grid-only.png");
  fs.writeFileSync(gridOnlyPath, Buffer.from(gridOnly.imageBase64, "base64"));
  console.log(`Grid-only image saved to: ${gridOnlyPath}`);

  // Test with mock fields
  const withFields = await compositeFieldsOntoImage({
    imageBase64: pageImageBase64,
    fields: mockFields,
    showGrid: true,
    gridSpacing: 10,
  });

  const withFieldsPath = path.join(outputDir, "with-fields.png");
  fs.writeFileSync(withFieldsPath, Buffer.from(withFields.imageBase64, "base64"));
  console.log(`With-fields image saved to: ${withFieldsPath}`);

  console.log("\nDone! Open the images in docs/tests/output/ to review the grid.");
}

main().catch(console.error);
