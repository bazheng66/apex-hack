import { cva, type VariantProps } from "class-variance-authority"
import type { ButtonHTMLAttributes } from "react"
import { cn } from "../../lib/cn.ts"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[2px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal",
  {
    variants: {
      variant: {
        primary: "bg-seal text-paper hover:bg-[#742418]",
        secondary: "border border-line bg-transparent text-ink hover:border-seal",
        ghost: "bg-transparent text-muted hover:text-ink",
      },
      size: {
        md: "h-12 px-6 text-sm",
        lg: "h-12 px-6 text-sm",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
)

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
