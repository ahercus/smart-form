"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PenLine, X, Loader2 } from "lucide-react";
import { SignaturePad } from "./SignaturePad";
import { SignaturePicker } from "./SignaturePicker";
import { useSignatures } from "@/hooks/useSignatures";
import type { Signature } from "@/lib/types";

interface SignatureFieldProps {
  value: string; // data URL or storage path of current signature
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function SignatureField({
  value,
  onChange,
  disabled = false,
  className = "",
}: SignatureFieldProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [showPad, setShowPad] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const {
    signatures,
    isLoading,
    createSignature,
    deleteSignature,
    setDefaultSignature,
  } = useSignatures();

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const handleClick = () => {
    if (disabled) return;

    // If user has saved signatures, show picker
    // Otherwise, go directly to signature pad
    if (signatures.length > 0) {
      setShowPicker(true);
    } else {
      setShowPad(true);
    }
  };

  const handleSelectSignature = (signature: Signature) => {
    // Use the preview data URL for immediate display
    if (signature.preview_data_url) {
      onChange(signature.preview_data_url);
    }
    setShowPicker(false);
  };

  const handleSaveSignature = async (
    dataUrl: string,
    blob: Blob,
    name: string,
    saveForLater: boolean
  ) => {
    // Always use the signature for the current field
    onChange(dataUrl);

    // If user wants to save for later, create signature record
    if (saveForLater) {
      setIsSaving(true);
      await createSignature(blob, name, dataUrl);
      setIsSaving(false);
    }

    setShowPad(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  const hasSignature = value && value.length > 0;

  return (
    <>
      <Card
        className={`relative overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-primary/50 ${
          disabled ? "opacity-50 cursor-not-allowed" : ""
        } ${className}`}
        onClick={handleClick}
      >
        {isLoading ? (
          <div className="aspect-[3/1] flex items-center justify-center">
            <Skeleton className="w-full h-full" />
          </div>
        ) : hasSignature ? (
          // Show current signature
          <div className="relative aspect-[3/1] bg-white">
            <Image
              src={value}
              alt="Your signature"
              fill
              className="object-contain p-2"
            />
            {!disabled && (
              <Button
                variant="secondary"
                size="icon"
                className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity"
                onClick={handleClear}
                title="Clear signature"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          // Empty state - prompt to add signature
          <div className="aspect-[3/1] border-2 border-dashed rounded-md flex flex-col items-center justify-center gap-2 text-muted-foreground bg-muted/30">
            {isSaving ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm">Saving signature...</span>
              </>
            ) : (
              <>
                <PenLine className="h-6 w-6" />
                <span className="text-sm">
                  {signatures.length > 0
                    ? "Tap to select signature"
                    : "Tap to add signature"}
                </span>
              </>
            )}
          </div>
        )}
      </Card>

      {/* Signature Picker */}
      <SignaturePicker
        open={showPicker}
        onOpenChange={setShowPicker}
        signatures={signatures}
        isLoading={isLoading}
        onSelect={handleSelectSignature}
        onCreateNew={() => {
          setShowPicker(false);
          setShowPad(true);
        }}
        onDelete={deleteSignature}
        onSetDefault={setDefaultSignature}
        isMobile={isMobile}
      />

      {/* Signature Pad */}
      <SignaturePad
        open={showPad}
        onOpenChange={setShowPad}
        onSave={handleSaveSignature}
        defaultSaveForLater={true}
        isMobile={isMobile}
      />
    </>
  );
}
