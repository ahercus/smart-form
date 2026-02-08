import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--glass-bg-light)] border-[var(--glass-border-light)] text-primary backdrop-blur-sm shadow-[inset_0_1px_0_var(--glass-highlight-light)] [a&]:hover:bg-[var(--glass-bg-button)]",
        secondary:
          "bg-[var(--glass-bg-light)] border-[var(--glass-border-light)] text-muted-foreground backdrop-blur-sm shadow-[inset_0_1px_0_var(--glass-highlight-light)] [a&]:hover:bg-[var(--glass-bg-button)]",
        destructive:
          "bg-[oklch(0.577_0.245_27.325/12%)] border-[var(--glass-border-light)] text-destructive backdrop-blur-sm shadow-[inset_0_1px_0_var(--glass-highlight-light)] focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "text-foreground shadow-[inset_0_1px_0_var(--glass-highlight-light)] backdrop-blur-sm [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
