import type { TextareaHTMLAttributes } from "react"
import { cn } from "../../lib/cn.ts"

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full resize-y rounded-[2px] border border-line bg-card px-4 py-3 text-sm leading-6 text-ink placeholder:text-muted/70 focus:border-seal",
        className,
      )}
      {...props}
    />
  )
}
