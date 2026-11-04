import { useEffect, useRef, useState, type RefObject } from "react"
import { COMPANION_HINTS, COMPANION_LINE, HINT_LABEL, copyLines, type CompanionHint } from "../features/companion.ts"

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
      <CompanionFigure hint={hint} />
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

/** The full seal figure. A click only changes its face; the line beside it stays with the rules. */
export function CompanionFigure({ hint, className = "h-24 w-[91px]" }: { hint: CompanionHint; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [pick, setPick] = useState<{ from: CompanionHint; face: CompanionHint } | null>(null)
  const face = pick && pick.from === hint ? pick.face : hint
  const look = usePointerLook(ref)

  function next() {
    const index = COMPANION_HINTS.indexOf(face)
    setPick({ from: hint, face: COMPANION_HINTS[(index + 1) % COMPANION_HINTS.length] })
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={next}
      aria-label={`换个表情，现在是${HINT_LABEL[face]}`}
      className="shrink-0 cursor-pointer rounded-[2px] bg-transparent p-0"
    >
      <SealMark hint={face} look={look} className={className} />
    </button>
  )
}

/** Small head-and-hands avatar for the talk page. It looks toward its bubble. */
export function CompanionAvatar({ hint }: { hint: CompanionHint }) {
  return <SealMark hint={hint} look={{ x: 1, y: 0 }} small className="h-[38px] w-[38px]" />
}

type Look = { x: number; y: number }

function usePointerLook(ref: RefObject<HTMLElement | null>): Look {
  const [look, setLook] = useState<Look>({ x: 0, y: 0 })
  useEffect(() => {
    const node = ref.current
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    let frame = 0
    function onMove(event: PointerEvent) {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!node) return
        const box = node.getBoundingClientRect()
        const dx = event.clientX - (box.left + box.width / 2)
        const dy = event.clientY - (box.top + box.height * 0.4)
        const x = Math.abs(dx) < box.width * 0.5 ? 0 : Math.sign(dx)
        const y = dy < -box.height * 0.5 ? -1 : 0
        setLook((prev) => (prev.x === x && prev.y === y ? prev : { x, y }))
      })
    }
    window.addEventListener("pointermove", onMove, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("pointermove", onMove)
    }
  }, [ref])
  return look
}

const INK = "#1c1612"
const SEAL = "#8f2d1f"
const SEAL_FACE = "#6b2117"
const EYE = "#fffaf3"
const SWEAT = "#9db4bf"

/** A walking square seal, drawn on a 20×21 pixel grid with rects only. */
function SealMark({ hint, look, small = false, className }: { hint: CompanionHint; look: Look; small?: boolean; className: string }) {
  const awake = hint === "encourage" || hint === "urge"
  return (
    <svg
      key={hint}
      data-hint={hint}
      viewBox={small ? "1.5 0.5 17 17" : "0 0 20 21"}
      shapeRendering="crispEdges"
      className={`seal ${small ? "seal-small" : ""} ${className}`}
      aria-hidden="true"
    >
      {!small && (
        <>
          <rect className="seal-shadow" x="5" y="19.4" width="10" height="0.8" fill={INK} opacity="0.12" />
          {hint === "celebrate" && <rect className="seal-print" x="4" y="19.2" width="12" height="1" fill={SEAL} />}
          {hint === "celebrate" && (
            <g fill={SEAL}>
              <rect className="seal-spark" x="1" y="3" width="1" height="1" />
              <rect className="seal-spark seal-spark-b" x="18" y="1" width="1" height="1" />
              <rect className="seal-spark seal-spark-c" x="19" y="5" width="1" height="1" fill={INK} />
            </g>
          )}
          {hint === "sleepy" && (
            <g fill={INK}>
              <PixelZ className="seal-z" x={15} y={3} scale={0.5} />
              <PixelZ className="seal-z seal-z-b" x={16.5} y={0} scale={0.7} />
            </g>
          )}
        </>
      )}

      <g className="seal-figure">
        {!small && (
          <g fill={INK}>
            <rect x="6" y="17" width="2" height="2" />
            <rect x="12" y="17" width="2" height="2" />
          </g>
        )}

        {hint === "celebrate" ? (
          <g fill={INK}>
            <rect className="seal-arm-l seal-arm-up" x="2" y="5" width="2" height="4" />
            <rect className="seal-arm-r seal-arm-up" x="16" y="5" width="2" height="4" />
          </g>
        ) : (
          <g fill={INK}>
            <rect className="seal-arm-l" x="2" y="10" width="2" height="3" />
            <rect className="seal-arm-r" x="16" y="10" width="2" height="3" />
          </g>
        )}

        <g className="seal-body">
          <rect x="4" y="15" width="12" height="2" fill={SEAL_FACE} />
          <rect x="4" y="6" width="12" height="9" fill={SEAL} />

          {awake && (
            <g className="seal-eyes">
              <rect x="6" y="8" width="3" height="3" fill={EYE} />
              <rect x="11" y="8" width="3" height="3" fill={EYE} />
              <g className="seal-pupils" fill={INK} style={{ transform: `translate(${look.x}px, ${look.y}px)` }}>
                <rect x="7" y="9" width="1" height="2" />
                <rect x="12" y="9" width="1" height="2" />
              </g>
            </g>
          )}
          {hint === "celebrate" && (
            <g fill={INK}>
              <rect x="6" y="9" width="1" height="1" />
              <rect x="7" y="8" width="1" height="1" />
              <rect x="8" y="9" width="1" height="1" />
              <rect x="11" y="9" width="1" height="1" />
              <rect x="12" y="8" width="1" height="1" />
              <rect x="13" y="9" width="1" height="1" />
            </g>
          )}
          {hint === "sleepy" && (
            <g fill={INK}>
              <rect x="6" y="10" width="3" height="1" />
              <rect x="11" y="10" width="3" height="1" />
            </g>
          )}
          {hint === "urge" && (
            <g fill={INK}>
              <rect x="6" y="7" width="1" height="1" />
              <rect x="7" y="6" width="1" height="1" />
              <rect x="12" y="6" width="1" height="1" />
              <rect x="13" y="7" width="1" height="1" />
            </g>
          )}

          <Mouth hint={hint} />
        </g>

        <g className="seal-handle" fill={INK}>
          <rect x="7" y="1" width="6" height="2" />
          <rect x="8" y="3" width="4" height="3" />
        </g>
      </g>

      {hint === "urge" && (
        <g className="seal-sweat" fill={SWEAT}>
          <rect x="17" y="4" width="1" height="1" />
          <rect x="16" y="5" width="2" height="2" />
        </g>
      )}
    </svg>
  )
}

function Mouth({ hint }: { hint: CompanionHint }) {
  if (hint === "encourage") {
    return (
      <g fill={INK}>
        <rect x="8" y="12" width="1" height="1" />
        <rect x="9" y="13" width="2" height="1" />
        <rect x="11" y="12" width="1" height="1" />
      </g>
    )
  }
  if (hint === "urge") {
    return (
      <g fill={INK}>
        <rect x="8" y="13" width="1" height="1" />
        <rect x="9" y="12" width="2" height="1" />
        <rect x="11" y="13" width="1" height="1" />
      </g>
    )
  }
  if (hint === "celebrate") {
    return (
      <g>
        <rect x="8" y="12" width="4" height="2" fill={INK} />
        <rect x="9" y="13" width="2" height="1" fill={SEAL_FACE} />
      </g>
    )
  }
  return <rect x="9" y="13" width="2" height="1" fill={INK} />
}

function PixelZ({ className, x, y, scale }: { className: string; x: number; y: number; scale: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className={className}>
        <rect x="0" y="0" width="4" height="1" />
        <rect x="2" y="1" width="1" height="1" />
        <rect x="1" y="2" width="1" height="1" />
        <rect x="0" y="3" width="4" height="1" />
      </g>
    </g>
  )
}
