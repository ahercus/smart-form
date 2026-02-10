import { useId } from "react";
import type { SVGProps } from "react";

type SparkleIconProps = SVGProps<SVGSVGElement>;

export function SparkleIcon({ className, ...props }: SparkleIconProps) {
  const gradientId = useId();

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="10%" y1="0%" x2="90%" y2="100%">
          <stop offset="0%" stopColor="#ff4d4d" />
          <stop offset="20%" stopColor="#ff8c1a" />
          <stop offset="40%" stopColor="#ffd60a" />
          <stop offset="60%" stopColor="#33d17a" />
          <stop offset="80%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M12 2.2L14.9 9.1L21.8 12L14.9 14.9L12 21.8L9.1 14.9L2.2 12L9.1 9.1L12 2.2Z"
      />
    </svg>
  );
}
