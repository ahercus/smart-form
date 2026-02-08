"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "bg-[var(--glass-bg-button)] border border-[var(--glass-border-light)] shadow-[inset_0_1px_0_var(--glass-highlight-light)] relative h-1.5 w-full overflow-hidden rounded-full",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-gradient-to-r from-[oklch(0.55_0.2_290/75%)] to-[oklch(0.6_0.15_240/75%)] shadow-[0_0_8px_oklch(0.55_0.2_290/30%)] h-full w-full flex-1 rounded-full transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
