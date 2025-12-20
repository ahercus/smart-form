"use client";

import { useState, useEffect, useCallback } from "react";
import { PDFViewer } from "./PDFViewer";
import { FieldInput } from "./FieldInput";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Save,
  Download,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import type { DocumentWithFields, ExtractedField } from "@/lib/types";
import Link from "next/link";

interface WizardInterfaceProps {
  documentId: string;
}

export function WizardInterface({ documentId }: WizardInterfaceProps) {
  const [document, setDocument] = useState<DocumentWithFields | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentFieldIndex, setCurrentFieldIndex] = useState(0);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch document data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [docRes, pdfRes] = await Promise.all([
          fetch(`/api/documents/${documentId}`),
          fetch(`/api/documents/${documentId}/pdf`),
        ]);

        if (!docRes.ok) {
          throw new Error("Failed to load document");
        }

        const docData = await docRes.json();
        setDocument(docData);

        // Initialize field values
        const values: Record<string, string> = {};
        docData.fields?.forEach((field: ExtractedField) => {
          values[field.id] = field.value || "";
        });
        setFieldValues(values);

        if (pdfRes.ok) {
          const pdfData = await pdfRes.json();
          setPdfUrl(pdfData.url);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to load document"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [documentId]);

  const fields = document?.fields || [];
  const currentField = fields[currentFieldIndex];
  const filledCount = Object.values(fieldValues).filter(
    (v) => v !== ""
  ).length;
  const progress = fields.length > 0 ? (filledCount / fields.length) * 100 : 0;

  // Auto-navigate to the field's page
  useEffect(() => {
    if (currentField && currentField.page_number !== currentPage) {
      setCurrentPage(currentField.page_number);
    }
  }, [currentField, currentPage]);

  const handleFieldChange = useCallback((fieldId: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  const handleFieldClick = useCallback(
    (fieldId: string) => {
      const index = fields.findIndex((f) => f.id === fieldId);
      if (index >= 0) {
        setCurrentFieldIndex(index);
      }
    },
    [fields]
  );

  const goToNext = () => {
    if (currentFieldIndex < fields.length - 1) {
      setCurrentFieldIndex(currentFieldIndex + 1);
    }
  };

  const goToPrev = () => {
    if (currentFieldIndex > 0) {
      setCurrentFieldIndex(currentFieldIndex - 1);
    }
  };

  const saveProgress = async () => {
    setSaving(true);
    try {
      const updates = Object.entries(fieldValues)
        .filter(([, value]) => value !== "")
        .map(([field_id, value]) => ({ field_id, value }));

      const res = await fetch(`/api/documents/${documentId}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });

      if (!res.ok) {
        throw new Error("Failed to save");
      }

      toast.success("Progress saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save progress"
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen p-4">
        <div className="max-w-7xl mx-auto">
          <Skeleton className="h-8 w-64 mb-4" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-[600px]" />
            <Skeleton className="h-[600px]" />
          </div>
        </div>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Document not found</h2>
          <Link href="/dashboard">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (document.status !== "ready") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">
            {document.status === "failed"
              ? "Document processing failed"
              : "Document is still processing"}
          </h2>
          {document.error_message && (
            <p className="text-destructive mb-4">{document.error_message}</p>
          )}
          <Link href="/dashboard">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (fields.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">No fields detected</h2>
          <p className="text-muted-foreground mb-4">
            This document doesn&apos;t appear to have any fillable form fields.
          </p>
          <Link href="/dashboard">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div>
                <h1 className="font-semibold truncate max-w-[300px]">
                  {document.original_filename}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {filledCount} of {fields.length} fields completed
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={saveProgress} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button disabled>
                <Download className="mr-2 h-4 w-4" />
                Export PDF
              </Button>
            </div>
          </div>
          <Progress value={progress} className="mt-3 h-2" />
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-140px)]">
          {/* PDF Viewer */}
          <Card className="overflow-hidden">
            {pdfUrl ? (
              <PDFViewer
                url={pdfUrl}
                fields={fields}
                currentFieldId={currentField?.id || null}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                onFieldClick={handleFieldClick}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                PDF preview not available
              </div>
            )}
          </Card>

          {/* Field Editor */}
          <Card className="flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">
                Field {currentFieldIndex + 1} of {fields.length}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              <ScrollArea className="flex-1 pr-4">
                <div className="space-y-6">
                  {currentField && (
                    <FieldInput
                      field={currentField}
                      value={fieldValues[currentField.id] || ""}
                      onChange={(value) =>
                        handleFieldChange(currentField.id, value)
                      }
                    />
                  )}

                  {/* Quick fill list */}
                  <div className="pt-4 border-t">
                    <h3 className="text-sm font-medium mb-3">All Fields</h3>
                    <div className="space-y-1">
                      {fields.map((field, index) => {
                        const isFilled = fieldValues[field.id] !== "";
                        const isCurrent = index === currentFieldIndex;
                        return (
                          <button
                            key={field.id}
                            onClick={() => setCurrentFieldIndex(index)}
                            className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors ${
                              isCurrent
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-muted"
                            }`}
                          >
                            <span
                              className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                isFilled
                                  ? "bg-green-500 border-green-500"
                                  : "border-muted-foreground"
                              }`}
                            >
                              {isFilled && (
                                <Check className="h-3 w-3 text-white" />
                              )}
                            </span>
                            <span className="truncate flex-1">
                              {field.label}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              p.{field.page_number}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </ScrollArea>

              {/* Navigation */}
              <div className="flex items-center justify-between pt-4 border-t mt-4">
                <Button
                  variant="outline"
                  onClick={goToPrev}
                  disabled={currentFieldIndex === 0}
                >
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Previous
                </Button>
                <Button
                  onClick={goToNext}
                  disabled={currentFieldIndex === fields.length - 1}
                >
                  Next
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
