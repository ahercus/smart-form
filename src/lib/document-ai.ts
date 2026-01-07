// Azure Document Intelligence integration for form field extraction
// Using prebuilt-layout model with keyValuePairs feature

import type { ExtractedField, NormalizedCoordinates } from "./types";

interface AzureConfig {
  endpoint: string;
  apiKey: string;
}

function getConfig(): AzureConfig {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const apiKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  if (!endpoint || !apiKey) {
    throw new Error(
      "Missing required environment variables: AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, AZURE_DOCUMENT_INTELLIGENCE_KEY"
    );
  }

  return { endpoint, apiKey };
}

interface AzurePolygon {
  polygon: number[];
  pageNumber: number;
}

interface AzureKeyValuePair {
  key: {
    content: string;
    boundingRegions?: AzurePolygon[];
  };
  value?: {
    content?: string;
    boundingRegions?: AzurePolygon[];
  };
  confidence: number;
}

interface AzureAnalyzeResult {
  status: string;
  analyzeResult?: {
    pages: Array<{
      pageNumber: number;
      width: number;
      height: number;
      unit: string;
    }>;
    keyValuePairs?: AzureKeyValuePair[];
  };
}

interface PolygonToCoordinatesOptions {
  polygon: number[] | undefined;
  pageWidth: number;
  pageHeight: number;
  isKeyRegion?: boolean; // If true, this is the label region, not the value region
}

function polygonToCoordinates(
  options: PolygonToCoordinatesOptions
): NormalizedCoordinates {
  const { polygon, pageWidth, pageHeight, isKeyRegion = false } = options;

  if (!polygon || polygon.length < 8) {
    return { left: 0, top: 0, width: 10, height: 4 };
  }

  // Azure polygon format: [x1, y1, x2, y2, x3, y3, x4, y4] in inches
  // Convert to normalized percentages (0-100)
  const xs = [polygon[0], polygon[2], polygon[4], polygon[6]];
  const ys = [polygon[1], polygon[3], polygon[5], polygon[7]];

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  let left = (minX / pageWidth) * 100;
  let top = (minY / pageHeight) * 100;
  let width = ((maxX - minX) / pageWidth) * 100;
  let height = ((maxY - minY) / pageHeight) * 100;

  // If this is a key (label) region and we're using it because there's no value region,
  // the actual input field is typically BELOW the label, not on top of it
  if (isKeyRegion) {
    const labelHeight = height;
    // Move the field below the label with a small gap
    top = top + labelHeight + 0.5; // Small gap between label and field
    // Make the field taller for input
    height = Math.max(3, labelHeight * 1.5);
    // Ensure minimum width for input fields
    width = Math.max(width, 15);
  }

  return { left, top, width, height };
}

function inferFieldType(
  fieldName: string,
  fieldValue: string | null
): ExtractedField["field_type"] {
  const name = fieldName.toLowerCase();

  if (name.includes("signature")) return "signature";
  if (name.includes("date") || name.includes("dob") || name.includes("birth"))
    return "date";

  // Azure marks checkboxes with :selected: or :unselected:
  if (
    fieldValue === ":selected:" ||
    fieldValue === ":unselected:" ||
    name.includes("checkbox") ||
    name.includes("agree") ||
    name.includes("consent")
  ) {
    return "checkbox";
  }

  if (
    name.includes("comment") ||
    name.includes("note") ||
    name.includes("description") ||
    name.includes("address")
  ) {
    return "textarea";
  }

  return "text";
}

export interface DocumentAIResult {
  pageCount: number;
  fields: ExtractedField[];
  rawResponse: unknown;
}

async function pollForResult(
  operationUrl: string,
  apiKey: string,
  maxAttempts = 30,
  delayMs = 1000
): Promise<AzureAnalyzeResult> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(operationUrl, {
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Azure polling failed: ${response.status} ${response.statusText}`);
    }

    const result: AzureAnalyzeResult = await response.json();

    if (result.status === "succeeded") {
      return result;
    }

    if (result.status === "failed") {
      throw new Error("Azure Document Intelligence analysis failed");
    }

    // Still running, wait and retry
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error("Azure Document Intelligence analysis timed out");
}

export async function extractFieldsFromPDF(
  documentId: string,
  pdfData: ArrayBuffer
): Promise<DocumentAIResult> {
  const totalStartTime = Date.now();
  console.log(`[AutoForm] ==========================================`);
  console.log(`[AutoForm] ⏱️ AZURE DI START:`, {
    documentId,
    pdfSize: pdfData.byteLength,
  });
  console.log(`[AutoForm] ==========================================`);

  const config = getConfig();

  // Start the analysis
  // Request multiple features to catch all form elements:
  // - keyValuePairs: labeled form fields
  // - (tables, selectionMarks are included by default in prebuilt-layout)
  // - pages=1-: Force processing ALL pages (workaround for Azure blank page detection bug)
  //   See: https://learn.microsoft.com/en-us/answers/questions/2138766
  const analyzeUrl = `${config.endpoint}documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30&features=keyValuePairs&pages=1-`;

  console.log(`[AutoForm] Calling Azure Document Intelligence:`, {
    documentId,
    endpoint: config.endpoint,
  });

  const startResponse = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": config.apiKey,
      "Content-Type": "application/pdf",
    },
    body: pdfData,
  });

  if (!startResponse.ok) {
    const errorText = await startResponse.text();
    throw new Error(
      `Azure analysis start failed: ${startResponse.status} ${startResponse.statusText} - ${errorText}`
    );
  }

  // Get the operation location for polling
  const operationLocation = startResponse.headers.get("operation-location");
  if (!operationLocation) {
    throw new Error("Azure did not return operation-location header");
  }

  console.log(`[AutoForm] Azure analysis started, polling for results...`);

  // Poll for results
  const result = await pollForResult(operationLocation, config.apiKey);

  const analyzeResult = result.analyzeResult;
  if (!analyzeResult) {
    throw new Error("Azure returned no analyzeResult");
  }

  // Log detailed Azure response for debugging
  // Cast to any to access all potential properties
  const rawResult = analyzeResult as Record<string, unknown>;
  console.log(`[AutoForm] Azure Document Intelligence response:`, {
    documentId,
    pageCount: analyzeResult.pages?.length || 0,
    keyValuePairsCount: analyzeResult.keyValuePairs?.length || 0,
    // Log which pages Azure actually detected
    pagesDetected: analyzeResult.pages?.map(p => ({
      pageNumber: p.pageNumber,
      dimensions: `${p.width}x${p.height} ${p.unit}`,
    })),
    // Log page numbers that have key-value pairs
    pagesWithKVP: [...new Set(
      analyzeResult.keyValuePairs?.flatMap(kvp => [
        ...(kvp.key.boundingRegions?.map(r => r.pageNumber) || []),
        ...(kvp.value?.boundingRegions?.map(r => r.pageNumber) || []),
      ]) || []
    )].sort(),
    // Log other content types Azure found
    tablesCount: Array.isArray(rawResult.tables) ? rawResult.tables.length : 0,
    paragraphsCount: Array.isArray(rawResult.paragraphs) ? rawResult.paragraphs.length : 0,
    // Check what top-level keys Azure returned
    responseKeys: Object.keys(rawResult),
  });

  // Build page dimensions map
  const pageDimensions: Record<number, { width: number; height: number }> = {};
  for (const page of analyzeResult.pages || []) {
    pageDimensions[page.pageNumber] = {
      width: page.width,
      height: page.height,
    };
  }

  // Extract fields from key-value pairs
  const fields: ExtractedField[] = [];
  const now = new Date().toISOString();

  analyzeResult.keyValuePairs?.forEach((kvp, fieldIndex) => {
    const keyContent = kvp.key.content?.trim() || `Field ${fieldIndex + 1}`;
    const valueContent = kvp.value?.content?.trim() || null;

    // Get page number from key or value bounding regions
    const keyRegions = kvp.key.boundingRegions || [];
    const valueRegions = kvp.value?.boundingRegions || [];
    const pageNumber = keyRegions[0]?.pageNumber || valueRegions[0]?.pageNumber || 1;

    // Get page dimensions
    const pageDim = pageDimensions[pageNumber] || { width: 8.5, height: 11 };

    // Get coordinates from value bounding region (where user will fill)
    // Fall back to key region if no value region
    const hasValueRegion = valueRegions.length > 0 && valueRegions[0]?.polygon;
    const polygon = hasValueRegion ? valueRegions[0].polygon : keyRegions[0]?.polygon;
    const coordinates = polygonToCoordinates({
      polygon,
      pageWidth: pageDim.width,
      pageHeight: pageDim.height,
      isKeyRegion: !hasValueRegion, // If using key region, we need to adjust position
    });

    // Determine if this is an empty field (no value or Azure's empty marker)
    const isEmpty = !valueContent || valueContent === "(empty)";
    const isCheckbox = valueContent === ":selected:" || valueContent === ":unselected:";

    const field: ExtractedField = {
      id: crypto.randomUUID(),
      document_id: documentId,
      page_number: pageNumber,
      field_index: fieldIndex,
      label: keyContent,
      field_type: inferFieldType(keyContent, valueContent),
      coordinates,
      value: isCheckbox ? (valueContent === ":selected:" ? "true" : null) : null,
      ai_suggested_value: isEmpty || isCheckbox ? null : valueContent,
      ai_confidence: kvp.confidence,
      help_text: null,
      detection_source: "azure_document_intelligence",
      confidence_score: kvp.confidence,
      manually_adjusted: false,
      deleted_at: null,
      choice_options: null,
      created_at: now,
      updated_at: now,
    };

    fields.push(field);
  });

  const totalDuration = Date.now() - totalStartTime;
  console.log(`[AutoForm] ⏱️ AZURE DI COMPLETE (${(totalDuration / 1000).toFixed(1)}s):`, {
    documentId,
    pageCount: analyzeResult.pages?.length || 1,
    fieldsExtracted: fields.length,
    fieldsByPage: fields.reduce(
      (acc, f) => {
        acc[f.page_number] = (acc[f.page_number] || 0) + 1;
        return acc;
      },
      {} as Record<number, number>
    ),
    durationMs: totalDuration,
  });

  return {
    pageCount: analyzeResult.pages?.length || 1,
    fields,
    rawResponse: result,
  };
}
