import fs from "node:fs/promises";

const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
const apiKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

if (!endpoint || !apiKey) {
  throw new Error(
    "Missing AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT or AZURE_DOCUMENT_INTELLIGENCE_KEY"
  );
}

const pdfPath = process.argv[2];
if (!pdfPath) {
  throw new Error("Usage: node scripts/azure-di-compare.mjs /path/to/file.pdf");
}

const pdfData = await fs.readFile(pdfPath);

async function pollForResult(operationUrl, apiKey, maxAttempts = 60, delayMs = 1000) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(operationUrl, {
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
      },
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after")) || 2;
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    if (!response.ok) {
      throw new Error(`Azure polling failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (result.status === "succeeded") {
      return result;
    }

    if (result.status === "failed") {
      throw new Error("Azure Document Intelligence analysis failed");
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error("Azure Document Intelligence analysis timed out");
}

function polygonKey(polygon) {
  if (!Array.isArray(polygon)) return "none";
  return polygon.map((n) => Number(n).toFixed(3)).join(",");
}

function kvpKey(kvp) {
  const key = (kvp.key?.content || "").trim();
  const value = (kvp.value?.content || "").trim();
  const keyRegion = kvp.key?.boundingRegions?.[0];
  const valueRegion = kvp.value?.boundingRegions?.[0];
  return [
    key,
    value,
    keyRegion?.pageNumber ?? "na",
    polygonKey(keyRegion?.polygon),
    valueRegion?.pageNumber ?? "na",
    polygonKey(valueRegion?.polygon),
  ].join("::");
}

function selectionKey(mark, pageNumber) {
  return [
    pageNumber ?? "na",
    mark.state ?? "na",
    polygonKey(mark.polygon),
  ].join("::");
}

function tableKey(table) {
  const region = table.boundingRegions?.[0];
  return [
    region?.pageNumber ?? "na",
    polygonKey(region?.polygon),
    table.rowCount ?? 0,
    table.columnCount ?? 0,
    table.cells?.length ?? 0,
  ].join("::");
}

async function runOnce(runIndex) {
  const analyzeUrl = `${endpoint}documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30&features=keyValuePairs&pages=1&readingOrder=natural`;
  const startResponse = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "application/pdf",
    },
    body: pdfData,
  });

  if (startResponse.status === 429) {
    const retryAfter = Number(startResponse.headers.get("retry-after")) || 2;
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return runOnce(runIndex);
  }

  if (!startResponse.ok) {
    const errorText = await startResponse.text();
    throw new Error(
      `Azure analysis start failed: ${startResponse.status} ${startResponse.statusText} - ${errorText}`
    );
  }

  const operationLocation = startResponse.headers.get("operation-location");
  if (!operationLocation) {
    throw new Error("Azure did not return operation-location header");
  }

  const result = await pollForResult(operationLocation, apiKey);
  const analyzeResult = result.analyzeResult;
  if (!analyzeResult) {
    throw new Error("Azure returned no analyzeResult");
  }

  const pages = analyzeResult.pages || [];
  const pageOne = pages.find((p) => p.pageNumber === 1);
  const selectionMarks = pageOne?.selectionMarks || [];

  const kvps = (analyzeResult.keyValuePairs || []).filter((kvp) => {
    const keyPages = kvp.key?.boundingRegions?.map((r) => r.pageNumber) || [];
    const valuePages = kvp.value?.boundingRegions?.map((r) => r.pageNumber) || [];
    return keyPages.includes(1) || valuePages.includes(1);
  });

  const tables = (analyzeResult.tables || []).filter((table) => {
    const pagesInTable = table.boundingRegions?.map((r) => r.pageNumber) || [];
    return pagesInTable.includes(1);
  });

  return {
    runIndex,
    kvps,
    selectionMarks,
    tables,
    rawResult: result,
  };
}

const runs = [];
for (let i = 1; i <= 3; i += 1) {
  console.log(`Run ${i}...`);
  // Small delay to avoid queuing issues between runs
  if (i > 1) {
    await new Promise((resolve) => setTimeout(resolve, 3500));
  }
  runs.push(await runOnce(i));
}

function toSet(items, keyFn) {
  return new Set(items.map(keyFn));
}

function diffSets(a, b) {
  const onlyA = [...a].filter((k) => !b.has(k));
  const onlyB = [...b].filter((k) => !a.has(k));
  return { onlyA, onlyB };
}

const summaries = runs.map((run) => ({
  runIndex: run.runIndex,
  kvpCount: run.kvps.length,
  selectionCount: run.selectionMarks.length,
  tableCount: run.tables.length,
}));

console.log("\nSummary:");
for (const s of summaries) {
  console.log(
    `Run ${s.runIndex}: kvp=${s.kvpCount}, selectionMarks=${s.selectionCount}, tables=${s.tableCount}`
  );
}

function buildDiffSummary(a, b) {
  const kvpDiff = diffSets(toSet(a.kvps, kvpKey), toSet(b.kvps, kvpKey));
  const selDiff = diffSets(
    toSet(a.selectionMarks, (m) => selectionKey(m, 1)),
    toSet(b.selectionMarks, (m) => selectionKey(m, 1))
  );
  const tableDiff = diffSets(toSet(a.tables, tableKey), toSet(b.tables, tableKey));
  return { kvpDiff, selDiff, tableDiff };
}

function logDiffSummary(title, diff) {
  console.log(`\nDiffs (${title}):`);
  console.log(`KVP only in Run 1: ${diff.kvpDiff.onlyA.length}`);
  console.log(`KVP only in Run 2: ${diff.kvpDiff.onlyB.length}`);
  console.log(`Selection only in Run 1: ${diff.selDiff.onlyA.length}`);
  console.log(`Selection only in Run 2: ${diff.selDiff.onlyB.length}`);
  console.log(`Tables only in Run 1: ${diff.tableDiff.onlyA.length}`);
  console.log(`Tables only in Run 2: ${diff.tableDiff.onlyB.length}`);
}

const diff12 = buildDiffSummary(runs[0], runs[1]);
const diff13 = buildDiffSummary(runs[0], runs[2]);

logDiffSummary("Run 1 vs Run 2", diff12);
logDiffSummary("Run 1 vs Run 3", diff13);

const outputDir = "docs/tests/output/azure-di";
await fs.mkdir(outputDir, { recursive: true });
for (const run of runs) {
  const filename = `${outputDir}/prep_questionnaire_page1_run_${run.runIndex}.json`;
  await fs.writeFile(filename, JSON.stringify(run.rawResult, null, 2));
}

function formatDiffSample(items, maxItems = 5) {
  if (items.length === 0) return "None";
  return items.slice(0, maxItems).map((item) => `- ${item}`).join("\n");
}

const reportLines = [
  "# Azure DI comparison report",
  "",
  "File: docs/tests/Prep Questionnaire 2025.pdf",
  "Page: 1",
  "",
  "## Summary",
  ...summaries.map(
    (s) =>
      `- Run ${s.runIndex}: kvp=${s.kvpCount}, selectionMarks=${s.selectionCount}, tables=${s.tableCount}`
  ),
  "",
  "## Diffs (Run 1 vs Run 2)",
  `- KVP only in Run 1: ${diff12.kvpDiff.onlyA.length}`,
  `- KVP only in Run 2: ${diff12.kvpDiff.onlyB.length}`,
  `- Selection only in Run 1: ${diff12.selDiff.onlyA.length}`,
  `- Selection only in Run 2: ${diff12.selDiff.onlyB.length}`,
  `- Tables only in Run 1: ${diff12.tableDiff.onlyA.length}`,
  `- Tables only in Run 2: ${diff12.tableDiff.onlyB.length}`,
  "",
  "### Samples (Run 1 vs Run 2)",
  "KVP only in Run 1:",
  formatDiffSample(diff12.kvpDiff.onlyA),
  "",
  "KVP only in Run 2:",
  formatDiffSample(diff12.kvpDiff.onlyB),
  "",
  "Selection only in Run 1:",
  formatDiffSample(diff12.selDiff.onlyA),
  "",
  "Selection only in Run 2:",
  formatDiffSample(diff12.selDiff.onlyB),
  "",
  "Tables only in Run 1:",
  formatDiffSample(diff12.tableDiff.onlyA),
  "",
  "Tables only in Run 2:",
  formatDiffSample(diff12.tableDiff.onlyB),
  "",
  "## Diffs (Run 1 vs Run 3)",
  `- KVP only in Run 1: ${diff13.kvpDiff.onlyA.length}`,
  `- KVP only in Run 3: ${diff13.kvpDiff.onlyB.length}`,
  `- Selection only in Run 1: ${diff13.selDiff.onlyA.length}`,
  `- Selection only in Run 3: ${diff13.selDiff.onlyB.length}`,
  `- Tables only in Run 1: ${diff13.tableDiff.onlyA.length}`,
  `- Tables only in Run 3: ${diff13.tableDiff.onlyB.length}`,
  "",
  "### Samples (Run 1 vs Run 3)",
  "KVP only in Run 1:",
  formatDiffSample(diff13.kvpDiff.onlyA),
  "",
  "KVP only in Run 3:",
  formatDiffSample(diff13.kvpDiff.onlyB),
  "",
  "Selection only in Run 1:",
  formatDiffSample(diff13.selDiff.onlyA),
  "",
  "Selection only in Run 3:",
  formatDiffSample(diff13.selDiff.onlyB),
  "",
  "Tables only in Run 1:",
  formatDiffSample(diff13.tableDiff.onlyA),
  "",
  "Tables only in Run 3:",
  formatDiffSample(diff13.tableDiff.onlyB),
  "",
];

const reportPath = `${outputDir}/prep_questionnaire_page1_report.md`;
await fs.writeFile(reportPath, reportLines.join("\n"));

console.log(`\nSaved raw JSON and report to ${outputDir}`);
