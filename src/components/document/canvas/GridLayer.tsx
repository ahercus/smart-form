"use client";

/**
 * GridLayer - Renders a dynamic grid that adapts to zoom level
 *
 * Grid density increases at higher zoom levels:
 * - Zoom 100% (scale 1): 10% grid lines
 * - Zoom 200% (scale 2): 5% grid lines
 * - Zoom 400% (scale 4): 2% grid lines
 * - Zoom 800%+ (scale 8+): 1% grid lines
 */

import React, { useMemo } from "react";
import { Line, Text, Rect, Group } from "react-konva";

interface GridLayerProps {
  pageWidth: number;
  pageHeight: number;
  scale?: number;
  visible?: boolean;
  /** When provided, shows region header and adjusts labels */
  regionBounds?: {
    top: number;
    left: number;
    bottom: number;
    right: number;
  };
}

/**
 * Calculate grid spacing based on scale
 * Higher zoom = denser grid for more precise positioning
 */
function getGridSpacing(scale: number): number {
  if (scale >= 8) return 1;
  if (scale >= 4) return 2;
  if (scale >= 2) return 5;
  return 10;
}

export function GridLayer({
  pageWidth,
  pageHeight,
  scale = 1,
  visible = true,
  regionBounds,
}: GridLayerProps) {
  const gridSpacing = getGridSpacing(scale);

  const { lines, labels, regionHeader } = useMemo(() => {
    const lines: React.ReactElement[] = [];
    const labels: React.ReactElement[] = [];

    // Minor grid lines (every gridSpacing %) - light gray, thin
    for (let x = 0; x <= 100; x += gridSpacing) {
      if (x % 25 !== 0) {
        const px = (x / 100) * pageWidth;
        lines.push(
          <Line
            key={`v-minor-${x}`}
            points={[px, 0, px, pageHeight]}
            stroke="#999999"
            strokeWidth={0.5}
            opacity={0.4}
          />
        );
      }
    }

    for (let y = 0; y <= 100; y += gridSpacing) {
      if (y % 25 !== 0) {
        const py = (y / 100) * pageHeight;
        lines.push(
          <Line
            key={`h-minor-${y}`}
            points={[0, py, pageWidth, py]}
            stroke="#999999"
            strokeWidth={0.5}
            opacity={0.4}
          />
        );
      }
    }

    // Major grid lines (every 25%) - darker, thicker
    for (let x = 0; x <= 100; x += 25) {
      const px = (x / 100) * pageWidth;
      lines.push(
        <Line
          key={`v-major-${x}`}
          points={[px, 0, px, pageHeight]}
          stroke="#666666"
          strokeWidth={1}
          opacity={0.6}
        />
      );
    }

    for (let y = 0; y <= 100; y += 25) {
      const py = (y / 100) * pageHeight;
      lines.push(
        <Line
          key={`h-major-${y}`}
          points={[0, py, pageWidth, py]}
          stroke="#666666"
          strokeWidth={1}
          opacity={0.6}
        />
      );
    }

    // Labels every 10% for precision
    for (let y = 0; y <= 100; y += 10) {
      const py = (y / 100) * pageHeight;
      const isMajor = y % 20 === 0;
      const fontSize = isMajor ? 11 : 9;

      // Y-axis labels (left edge)
      labels.push(
        <Group key={`y-label-${y}`}>
          <Rect
            x={0}
            y={py}
            width={24}
            height={14}
            fill="white"
            opacity={0.8}
          />
          <Text
            x={2}
            y={py + 2}
            text={String(y)}
            fontSize={fontSize}
            fontStyle={isMajor ? "bold" : "normal"}
            fill="#000000"
          />
        </Group>
      );
    }

    for (let x = 10; x <= 100; x += 10) {
      const px = (x / 100) * pageWidth;
      const isMajor = x % 20 === 0;
      const fontSize = isMajor ? 11 : 9;

      // X-axis labels (top edge)
      labels.push(
        <Group key={`x-label-${x}`}>
          <Rect
            x={px - 12}
            y={0}
            width={24}
            height={14}
            fill="white"
            opacity={0.8}
          />
          <Text
            x={px - 10}
            y={2}
            text={String(x)}
            fontSize={fontSize}
            fontStyle={isMajor ? "bold" : "normal"}
            fill="#000000"
          />
        </Group>
      );
    }

    // Region header for cluster crops
    let regionHeader: React.ReactElement | null = null;
    if (regionBounds) {
      const regionLabel = `Region: ${Math.round(regionBounds.left)}-${Math.round(regionBounds.right)}% left, ${Math.round(regionBounds.top)}-${Math.round(regionBounds.bottom)}% top`;
      regionHeader = (
        <Group key="region-header">
          <Rect
            x={30}
            y={0}
            width={regionLabel.length * 6 + 10}
            height={16}
            fill="rgba(0,0,0,0.8)"
          />
          <Text
            x={35}
            y={3}
            text={regionLabel}
            fontSize={10}
            fontStyle="bold"
            fill="white"
          />
        </Group>
      );
    }

    return { lines, labels, regionHeader };
  }, [pageWidth, pageHeight, gridSpacing, regionBounds]);

  if (!visible) return null;

  return (
    <>
      {lines}
      {labels}
      {regionHeader}
    </>
  );
}
