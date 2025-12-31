"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ExtractedField, NormalizedCoordinates } from "@/lib/types";
import type { PixelCoordinates } from "./types";

interface ChoiceFieldOverlayProps {
  field: ExtractedField;
  value: string;
  pixelCoords: PixelCoordinates;
  containerSize: { width: number; height: number };
  isActive: boolean;
  isHighlighted: boolean;
  onClick: (fieldId: string) => void;
  onValueChange: (fieldId: string, value: string) => void;
}

function getChoiceOverlayClasses(
  isActive: boolean,
  isHighlighted: boolean,
  hasValue: boolean
): string {
  return `w-full h-full transition-colors cursor-pointer ${
    isActive
      ? "border-2 border-blue-500 bg-blue-500/15"
      : isHighlighted
        ? "border-2 border-purple-500 bg-purple-500/15"
        : hasValue
          ? "bg-green-500/10 hover:bg-green-500/20"
          : "bg-orange-400/10 hover:bg-orange-400/20"
  }`;
}

// Convert normalized coordinates to pixel coordinates
function normalizedToPixel(
  coords: NormalizedCoordinates,
  containerSize: { width: number; height: number }
): PixelCoordinates {
  return {
    x: (coords.left / 100) * containerSize.width,
    y: (coords.top / 100) * containerSize.height,
    width: (coords.width / 100) * containerSize.width,
    height: (coords.height / 100) * containerSize.height,
  };
}

export function ChoiceFieldOverlay({
  field,
  value,
  pixelCoords,
  containerSize,
  isActive,
  isHighlighted,
  onClick,
  onValueChange,
}: ChoiceFieldOverlayProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const choiceOptions = field.choice_options || [];
  const hasValue = !!value;

  // Find the selected option to draw circle around it
  const selectedOption = choiceOptions.find((opt) => opt.label === value);

  const handleSelect = (optionLabel: string) => {
    onValueChange(field.id, optionLabel);
    setOpen(false);
    onClick(field.id);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick(field.id);
  };

  const baseClasses = getChoiceOverlayClasses(isActive, isHighlighted, hasValue);

  const TriggerContent = (
    <div
      className={`absolute group ${baseClasses}`}
      style={{
        left: pixelCoords.x,
        top: pixelCoords.y,
        width: pixelCoords.width,
        height: pixelCoords.height,
      }}
      onClick={handleClick}
    >
      {/* Render circle around selected option */}
      {selectedOption && containerSize.width > 0 && (
        <div
          className="absolute border-2 border-black rounded-full pointer-events-none"
          style={{
            ...(() => {
              const optionPixel = normalizedToPixel(
                selectedOption.coordinates,
                containerSize
              );
              // Position relative to field container
              const relativeX = optionPixel.x - pixelCoords.x;
              const relativeY = optionPixel.y - pixelCoords.y;
              // Add padding to circle
              const padding = 4;
              return {
                left: relativeX - padding,
                top: relativeY - padding,
                width: optionPixel.width + padding * 2,
                height: optionPixel.height + padding * 2,
              };
            })(),
          }}
        />
      )}
      <div className="absolute -top-6 left-0 bg-black/75 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
        {field.label}
      </div>
    </div>
  );

  const OptionsContent = (
    <div className="flex gap-2">
      {choiceOptions.map((option) => (
        <Button
          key={option.label}
          variant={value === option.label ? "default" : "outline"}
          onClick={() => handleSelect(option.label)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{TriggerContent}</DrawerTrigger>
        <DrawerContent className="pb-6">
          <div className="flex justify-center gap-4 pt-4">
            {choiceOptions.map((option) => (
              <Button
                key={option.label}
                variant={value === option.label ? "default" : "outline"}
                size="lg"
                onClick={() => handleSelect(option.label)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{TriggerContent}</PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="center">
        {OptionsContent}
      </PopoverContent>
    </Popover>
  );
}
