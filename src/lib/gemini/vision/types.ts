import type { NormalizedCoordinates, FieldType, ChoiceOption } from "../../types";

export interface FieldReviewResult {
  adjustments: Array<{
    fieldId: string;
    action: "update";
    changes: Partial<{
      label: string;
      fieldType: FieldType;
      coordinates: NormalizedCoordinates;
      choiceOptions: ChoiceOption[];
    }>;
  }>;
  newFields: Array<{
    label: string;
    fieldType: FieldType;
    coordinates: NormalizedCoordinates;
    choiceOptions?: ChoiceOption[];
  }>;
  removeFields: string[];
  fieldsValidated: boolean;
}
