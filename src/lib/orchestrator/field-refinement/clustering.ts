import type { ExtractedField } from "../../types";

export interface FieldCluster {
  bounds: {
    top: number;
    left: number;
    bottom: number;
    right: number;
  };
  fields: ExtractedField[];
  index: number;
}

function createBandCluster(fields: ExtractedField[], index: number): FieldCluster {
  let minTop = 100;
  let maxBottom = 0;

  for (const field of fields) {
    minTop = Math.min(minTop, field.coordinates.top);
    maxBottom = Math.max(maxBottom, field.coordinates.top + field.coordinates.height);
  }

  const padding = 5;

  return {
    fields,
    index,
    bounds: {
      left: 0,
      right: 100,
      top: Math.max(0, minTop - padding),
      bottom: Math.min(100, maxBottom + padding),
    },
  };
}

function clusterFieldsByHorizontalBands(
  fields: ExtractedField[],
  verticalThreshold: number = 15
): FieldCluster[] {
  if (fields.length === 0) return [];

  const sortedFields = [...fields].sort((a, b) => a.coordinates.top - b.coordinates.top);
  const clusters: FieldCluster[] = [];

  let currentCluster: ExtractedField[] = [];
  let currentClusterBottom = -1;

  for (const field of sortedFields) {
    const fieldTop = field.coordinates.top;
    const fieldBottom = field.coordinates.top + field.coordinates.height;

    if (currentCluster.length === 0) {
      currentCluster = [field];
      currentClusterBottom = fieldBottom;
      continue;
    }

    const distanceToCluster = Math.max(0, fieldTop - currentClusterBottom);
    if (distanceToCluster <= verticalThreshold) {
      currentCluster.push(field);
      currentClusterBottom = Math.max(currentClusterBottom, fieldBottom);
    } else {
      clusters.push(createBandCluster(currentCluster, clusters.length));
      currentCluster = [field];
      currentClusterBottom = fieldBottom;
    }
  }

  if (currentCluster.length > 0) {
    clusters.push(createBandCluster(currentCluster, clusters.length));
  }

  return clusters;
}

export function clusterPageFields(
  fields: ExtractedField[],
  pageNumber: number
): FieldCluster[] {
  const pageFields = fields.filter((f) => f.page_number === pageNumber);
  if (pageFields.length === 0) return [];

  const clusters = clusterFieldsByHorizontalBands(pageFields, 15);

  console.log(`[AutoForm] Page ${pageNumber} clustered into ${clusters.length} groups:`, {
    fieldCount: pageFields.length,
    clusterDetails: clusters.map((c) => ({
      index: c.index,
      fields: c.fields.length,
      bounds: `${c.bounds.top.toFixed(0)}-${c.bounds.bottom.toFixed(0)}%, ${c.bounds.left.toFixed(0)}-${c.bounds.right.toFixed(0)}%`,
    })),
  });

  return clusters;
}
