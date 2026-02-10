import type { SVGProps } from "react";

type FitFormLogoProps = SVGProps<SVGSVGElement>;

export function FitFormLogo({ className, ...props }: FitFormLogoProps) {

  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect
        x="4"
        y="4"
        width="112"
        height="112"
        rx="26"
        fill="#7c3aed"
      />

      {/* Back page (messy, lots of lines) */}
      <g opacity="0.2">
        <rect x="46" y="18" width="44" height="56" rx="4" fill="white" />
        <line x1="52" y1="28" x2="84" y2="28" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <line x1="52" y1="34" x2="80" y2="34" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <line x1="52" y1="40" x2="82" y2="40" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <line x1="52" y1="46" x2="76" y2="46" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <line x1="52" y1="52" x2="84" y2="52" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <line x1="52" y1="58" x2="78" y2="58" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <line x1="52" y1="64" x2="81" y2="64" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* Front page (clean, checkmarks) */}
      <rect x="22" y="40" width="50" height="56" rx="6" fill="white" opacity="0.9" />

      <circle cx="34" cy="54" r="5" fill="#7c3aed" opacity="0.8" />
      <path d="M 31.5 54 L 33 55.8 L 36.5 52" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="44" y1="54" x2="64" y2="54" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" opacity="0.4" />

      <circle cx="34" cy="68" r="5" fill="#7c3aed" opacity="0.8" />
      <path d="M 31.5 68 L 33 69.8 L 36.5 66" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="44" y1="68" x2="60" y2="68" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" opacity="0.4" />

      <circle cx="34" cy="82" r="5" fill="#7c3aed" opacity="0.8" />
      <path d="M 31.5 82 L 33 83.8 L 36.5 80" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="44" y1="82" x2="66" y2="82" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" opacity="0.4" />

      {/* Sparkles */}
      <g transform="translate(82, 30)">
        <path d="M 0 -10 L 2 -2 L 10 0 L 2 2 L 0 10 L -2 2 L -10 0 L -2 -2 Z" fill="white">
          <animate attributeName="opacity" values="0;0.9;0.9;0" dur="2.5s" repeatCount="indefinite" begin="0s" />
          <animateTransform attributeName="transform" type="scale" values="0.3;1;1;0.3" dur="2.5s" repeatCount="indefinite" begin="0s" />
        </path>
      </g>
      <g transform="translate(94, 48) scale(0.5)">
        <path d="M 0 -10 L 2 -2 L 10 0 L 2 2 L 0 10 L -2 2 L -10 0 L -2 -2 Z" fill="white">
          <animate attributeName="opacity" values="0;0.6;0.6;0" dur="2s" repeatCount="indefinite" begin="0.8s" />
          <animateTransform attributeName="transform" type="scale" values="0.3;1;1;0.3" dur="2s" repeatCount="indefinite" begin="0.8s" />
        </path>
      </g>
      <g transform="translate(90, 22) scale(0.35)">
        <path d="M 0 -10 L 2 -2 L 10 0 L 2 2 L 0 10 L -2 2 L -10 0 L -2 -2 Z" fill="white">
          <animate attributeName="opacity" values="0;0.5;0.5;0" dur="1.8s" repeatCount="indefinite" begin="1.5s" />
          <animateTransform attributeName="transform" type="scale" values="0.3;1;1;0.3" dur="1.8s" repeatCount="indefinite" begin="1.5s" />
        </path>
      </g>
    </svg>
  );
}
