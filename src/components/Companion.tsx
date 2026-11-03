import { useEffect, useRef } from "react"
import { COMPANION_LINE, HINT_LABEL, copyLines, type CompanionHint } from "../features/companion.ts"

export function Companion({
  hint,
  copyKeys = [],
  detail,
  forced = false,
}: {
  hint: CompanionHint
  copyKeys?: readonly string[]
  detail?: string
  forced?: boolean
}) {
  const ref = useRef<HTMLElement>(null)
  const seen = useRef(hint)
  useEffect(() => {
    if (seen.current === hint) return
    seen.current = hint
    ref.current?.scrollIntoView({ block: "nearest" })
  }, [hint])

  const lines = copyLines(copyKeys)

  return (
    <aside
      ref={ref}
      data-companion={hint}
      aria-live="polite"
      className="mt-8 flex scroll-mt-6 items-start gap-4 rounded-[2px] border border-line bg-card px-4 py-4 sm:gap-5 sm:px-5"
    >
      <CompanionMark hint={hint} />
      <div className="min-w-0 pt-1">
        <p className="text-[11px] tracking-[0.18em] text-muted">
          {HINT_LABEL[hint]}
          {forced ? " · 演示" : ""}
        </p>
        <p className="mt-2 font-serif text-xl leading-snug text-ink sm:text-2xl">{COMPANION_LINE[hint]}</p>
        {detail && <p className="mt-2 text-xs tracking-wide text-muted">{detail}</p>}
        {lines.length > 0 && (
          <ul className="mt-3 space-y-1">
            {lines.map((line) => (
              <li key={line} className="text-sm leading-6 text-muted">
                {line}
              </li>
            ))}
          </ul>
        )}
        {forced && <p className="mt-2 text-xs text-muted">只改这一句的状态，分数和专项仍按规则。</p>}
      </div>
    </aside>
  )
}

function CompanionMark({ hint }: { hint: CompanionHint }) {
  return (
    <svg
      key={hint}
      data-hint={hint}
      viewBox="0 0 72 84"
      className="companion-mark h-24 w-[5.15rem] shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <g className="companion-sparks">
        <circle className="companion-spark" cx="14" cy="22" r="1.7" fill="#8f2d1f" />
        <circle className="companion-spark companion-spark-b" cx="58" cy="16" r="1.5" fill="#8f2d1f" />
        <circle className="companion-spark companion-spark-c" cx="62" cy="30" r="1.2" fill="#8f2d1f" />
      </g>
      <ellipse className="companion-shadow" cx="36" cy="78" rx="16" ry="2.2" fill="#1c1612" opacity="0.12" />
      <g className="companion-figure">
        <path
          className="companion-body"
          fill="#1c1612"
          d="M22 44c2.6 2.2 7.2 3.2 14 3.2s11.4-1 14-3.2l6.5 26.2c.35 1.25-.6 2.5-1.9 2.5H17.4c-1.3 0-2.25-1.25-1.9-2.5L22 44z"
        />
        <rect className="companion-seal" x="32" y="54" width="8" height="8" fill="#8f2d1f" />
        <g className="companion-head">
          <circle className="companion-face" cx="36" cy="28" r="13" fill="#1c1612" />
          <g className="companion-eyes-open" fill="none" stroke="#f3ecdf" strokeWidth="1.8" strokeLinecap="round">
            <path d="M27.6 28.2h5" />
            <path d="M39.4 28.2h5" />
          </g>
          <g className="companion-eyes-shut" fill="none" stroke="#f3ecdf" strokeWidth="1.8" strokeLinecap="round">
            <path d="M27.4 27.2c1.7 2.6 3.6 2.6 5.3 0" />
            <path d="M39.2 27.2c1.7 2.6 3.6 2.6 5.3 0" />
          </g>
        </g>
      </g>
    </svg>
  )
}
