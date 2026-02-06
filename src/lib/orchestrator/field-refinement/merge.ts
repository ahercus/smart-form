import type { FieldReviewResult } from "../../gemini/vision";

export function mergeClusterResults(clusterResults: FieldReviewResult[]): FieldReviewResult {
  const adjustments: FieldReviewResult["adjustments"] = [];
  const newFields: FieldReviewResult["newFields"] = [];
  const removeFields: string[] = [];
  let allValidated = true;

  for (const result of clusterResults) {
    adjustments.push(...result.adjustments);
    newFields.push(...result.newFields);
    removeFields.push(...result.removeFields);
    if (!result.fieldsValidated) {
      allValidated = false;
    }
  }

  const uniqueRemoveFields = [...new Set(removeFields)];

  return {
    adjustments,
    newFields,
    removeFields: uniqueRemoveFields,
    fieldsValidated: allValidated,
  };
}

export function convertDiscoveryCoordinates(
  result: FieldReviewResult & { durationMs: number },
  imageWidth: number,
  imageHeight: number
): FieldReviewResult & { durationMs: number } {
  const looksLikePixels = (coords: { left: number; top: number; width: number; height: number }) =>
    coords.left > 100 || coords.top > 100 || coords.width > 100 || coords.height > 100;

  const convertCoords = (coords: { left: number; top: number; width: number; height: number }) =>
    looksLikePixels(coords)
      ? {
          left: (coords.left / imageWidth) * 100,
          top: (coords.top / imageHeight) * 100,
          width: (coords.width / imageWidth) * 100,
          height: (coords.height / imageHeight) * 100,
        }
      : coords;

  const convertedNewFields = result.newFields.map((field) => {
    const convertedCoords = convertCoords(field.coordinates);
    const needsConversion = looksLikePixels(field.coordinates);

    if (needsConversion) {
      console.log(`[AutoForm] Discovery: Converting pixel coords for "${field.label}":`, {
        from: field.coordinates,
        to: convertedCoords,
      });
    }

    return {
      ...field,
      coordinates: convertedCoords,
      choiceOptions: field.choiceOptions?.map((opt) => ({
        ...opt,
        coordinates: convertCoords(opt.coordinates),
      })),
    };
  });

  return {
    ...result,
    newFields: convertedNewFields,
  };
}
