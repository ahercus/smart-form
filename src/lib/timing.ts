// Timing utility for logging step durations

export class StepTimer {
  private stepName: string;
  private startTime: number;
  private documentId: string;

  constructor(documentId: string, stepName: string) {
    this.documentId = documentId;
    this.stepName = stepName;
    this.startTime = performance.now();
    console.log(`[AutoForm] ⏱️ START: ${stepName}`, { documentId });
  }

  end(details?: Record<string, unknown>): number {
    const duration = Math.round(performance.now() - this.startTime);
    console.log(`[AutoForm] ⏱️ END: ${this.stepName} (${duration}ms)`, {
      documentId: this.documentId,
      durationMs: duration,
      ...details,
    });
    return duration;
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export interface ProcessingTimings {
  parsing?: number;
  compositing?: number;
  geminiVision?: number;
  questionGeneration?: number;
  fieldUpdates?: number;
  total?: number;
}
