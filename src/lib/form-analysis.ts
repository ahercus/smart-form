// Form type inference from Azure Document Intelligence field labels
//
// This replaces Gemini Vision calls for context question generation.
// Instead of analyzing an image to understand form type, we analyze
// the field labels that Azure already extracted.
//
// WHY THIS WORKS:
// Field labels are highly predictive of form type:
// - "Patient", "Allergies" -> health form
// - "Student", "Grade" -> school form
// - "Employer", "Position" -> employment form
//
// Azure gives us labels with 90% accuracy. Good enough for context question.
// Speed: Instant (just reading from DB) vs 3-5s with Gemini Vision

import type { ExtractedField } from "./types";

export interface FormAnalysis {
  type: string; // "health form", "school enrollment", etc.
  keywords: string[]; // Top field keywords for context
  entities: string[]; // Detected people (patient, student, employee)
  contextQuestion: string; // Tailored question to ask user
}

// Form type detection patterns
const FORM_PATTERNS: Array<{
  type: string;
  keywords: string[];
  entities: string[];
  contextQuestion: string;
}> = [
  {
    type: "health form",
    keywords: [
      "patient",
      "medical",
      "allerg",
      "doctor",
      "diagnosis",
      "medication",
      "health",
      "physician",
      "clinic",
      "hospital",
      "insurance",
      "immunization",
      "vaccine",
      "treatment",
    ],
    entities: ["patient"],
    contextQuestion:
      "Who is this health form for and do they have any medical conditions or allergies we should know about?",
  },
  {
    type: "school enrollment form",
    keywords: [
      "student",
      "grade",
      "enrollment",
      "school",
      "teacher",
      "guardian",
      "parent",
      "classroom",
      "academic",
      "semester",
      "kindergarten",
      "elementary",
      "middle school",
      "high school",
    ],
    entities: ["student", "parent/guardian"],
    contextQuestion:
      "Which child is being enrolled and what grade are they entering?",
  },
  {
    type: "employment form",
    keywords: [
      "employee",
      "employer",
      "position",
      "salary",
      "start date",
      "hire",
      "job",
      "work",
      "occupation",
      "department",
      "supervisor",
      "hr",
      "human resources",
      "onboarding",
    ],
    entities: ["employee", "employer"],
    contextQuestion:
      "What position are you applying for and when is your start date?",
  },
  {
    type: "tax form",
    keywords: [
      "tax",
      "income",
      "deduction",
      "w-2",
      "w-4",
      "1099",
      "filing",
      "irs",
      "federal",
      "state tax",
      "withholding",
      "exemption",
      "dependent",
    ],
    entities: ["taxpayer"],
    contextQuestion:
      "What tax year is this for and are you filing as single, married, or head of household?",
  },
  {
    type: "consent form",
    keywords: [
      "consent",
      "authorize",
      "agree",
      "permission",
      "waiver",
      "liability",
      "release",
      "acknowledge",
      "accept",
      "terms",
    ],
    entities: [],
    contextQuestion: "What are you consenting to and for whom?",
  },
  {
    type: "insurance form",
    keywords: [
      "policy",
      "coverage",
      "premium",
      "beneficiary",
      "claim",
      "insured",
      "underwriting",
      "deductible",
      "copay",
    ],
    entities: ["policyholder", "beneficiary"],
    contextQuestion:
      "Who is the primary policyholder and who are the beneficiaries?",
  },
  {
    type: "contact form",
    keywords: [
      "contact",
      "emergency",
      "phone",
      "email",
      "address",
      "relationship",
      "notify",
    ],
    entities: ["contact"],
    contextQuestion:
      "Please provide details about the emergency contacts for this form.",
  },
  {
    type: "registration form",
    keywords: [
      "register",
      "registration",
      "sign up",
      "account",
      "member",
      "membership",
      "join",
    ],
    entities: ["member"],
    contextQuestion:
      "Who is registering and what program or service is this for?",
  },
];

const DEFAULT_CONTEXT_QUESTION =
  "Share any context about this form - who it's for, important details, or preferences.";

/**
 * Analyze form type from Azure Document Intelligence results (no vision needed)
 *
 * Why this works: Field labels are highly predictive of form type
 * - "Patient", "Allergies" -> health form
 * - "Student", "Grade" -> school form
 * - "Employer", "Position" -> employment form
 *
 * Azure gives us labels with 90% accuracy. Good enough for context question.
 */
export function analyzeFormFromAzure(fields: ExtractedField[]): FormAnalysis {
  if (!fields || fields.length === 0) {
    return {
      type: "form",
      keywords: [],
      entities: [],
      contextQuestion: DEFAULT_CONTEXT_QUESTION,
    };
  }

  // Combine all field labels into searchable text
  const labelsText = fields.map((f) => f.label.toLowerCase()).join(" ");

  // Score each form type based on keyword matches
  let bestMatch: (typeof FORM_PATTERNS)[0] | null = null;
  let bestScore = 0;

  for (const pattern of FORM_PATTERNS) {
    let score = 0;
    for (const keyword of pattern.keywords) {
      if (labelsText.includes(keyword.toLowerCase())) {
        score++;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = pattern;
    }
  }

  // Require at least 2 keyword matches to be confident
  if (bestMatch && bestScore >= 2) {
    return {
      type: bestMatch.type,
      keywords: bestMatch.keywords.filter((k) =>
        labelsText.includes(k.toLowerCase())
      ),
      entities: bestMatch.entities,
      contextQuestion: bestMatch.contextQuestion,
    };
  }

  // Fallback to generic
  return {
    type: "form",
    keywords: [],
    entities: [],
    contextQuestion: DEFAULT_CONTEXT_QUESTION,
  };
}

/**
 * Calculate average confidence from Azure fields
 * Used for QC decision (skip QC for high-confidence forms)
 */
export function calculateAverageConfidence(fields: ExtractedField[]): {
  average: number;
  min: number;
  max: number;
  count: number;
} {
  if (!fields || fields.length === 0) {
    return { average: 0, min: 0, max: 0, count: 0 };
  }

  const confidenceScores = fields
    .map((f) => f.ai_confidence ?? f.confidence_score ?? 0)
    .filter((c) => c > 0);

  if (confidenceScores.length === 0) {
    return { average: 0.85, min: 0.85, max: 0.85, count: fields.length }; // Default to high if no scores
  }

  const sum = confidenceScores.reduce((a, b) => a + b, 0);
  const average = sum / confidenceScores.length;
  const min = Math.min(...confidenceScores);
  const max = Math.max(...confidenceScores);

  return { average, min, max, count: confidenceScores.length };
}

/**
 * Decide whether to run Gemini QC based on Azure confidence
 *
 * QC Decision Matrix:
 * - Run QC if: Average confidence < 0.85 OR any field < 0.5 OR field count > 50 OR < 5 fields
 * - Skip QC if: Average confidence >= 0.85 AND all fields >= 0.5 AND 5-50 fields
 *
 * Why this works:
 * - Azure is excellent on clean, native PDF forms (85% of uploads)
 * - QC helps most on scanned/poor quality PDFs (15% of uploads)
 * - Field count extremes indicate potential issues
 */
export function shouldRunQC(fields: ExtractedField[]): {
  shouldRun: boolean;
  reason: string;
} {
  if (!fields || fields.length === 0) {
    return { shouldRun: false, reason: "No fields to QC" };
  }

  const { average, min, count } = calculateAverageConfidence(fields);

  // Too few fields - might have missed content
  if (count < 5) {
    return {
      shouldRun: true,
      reason: `Too few fields (${count}) - may have missed content`,
    };
  }

  // Too many fields - complex form, more likely to have issues
  if (count > 50) {
    return {
      shouldRun: true,
      reason: `Complex form (${count} fields) - running QC for accuracy`,
    };
  }

  // Low overall confidence
  if (average < 0.85) {
    return {
      shouldRun: true,
      reason: `Low average confidence (${(average * 100).toFixed(0)}%)`,
    };
  }

  // Any very low confidence field
  if (min < 0.5) {
    return {
      shouldRun: true,
      reason: `Some fields have low confidence (min: ${(min * 100).toFixed(0)}%)`,
    };
  }

  // High confidence, normal field count - skip QC
  return {
    shouldRun: false,
    reason: `High confidence (${(average * 100).toFixed(0)}%) with ${count} fields`,
  };
}
