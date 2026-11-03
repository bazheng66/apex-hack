import { useState } from "react"
import { cn } from "../../lib/cn.ts"
import { firstEvictionDifference, simulateFifo, simulateLru, type PagingStep } from "./paging.ts"

function readPages(raw: string): number[] {
  return raw
    .split(/[^\d]+/)
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((page) => Number.isFinite(page))
}

function readFrames(raw: string): number {
  if (raw.trim() === "") return 3
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 3
  return Math.min(8, Math.max(1, Math.round(parsed)))
}

function evictionPhrase(name: string, evicted: number | null): string {
  return evicted === null ? `${name} 没有淘汰` : `${name} 丢掉 ${evicted}`
}

function StepColumn({ title, hint, step, hot }: { title: string; hint: string; step: PagingStep | undefined; hot: boolean }) {
  return (
    <div className={cn("rounded-[2px] border px-4 py-4", hot ? "border-seal" : "border-line")}>
      <p className="text-xs text-muted">{title}</p>
      <p className="mt-3 text-sm">{step && step.frames.length > 0 ? step.frames.join("  ") : "空"}</p>
      <p className="mt-2 text-sm text-muted">{hint}</p>
      <p className="mt-2 text-sm">
        {!step ? "还没有访问" : !step.fault ? "命中，不淘汰" : step.evicted === null ? "缺页，页框还没满" : `缺页，淘汰 ${step.evicted}`}
      </p>
    </div>
  )
}

export function PagingLab() {
  const [frameText, setFrameText] = useState("3")
  const [serial, setSerial] = useState("1,2,3,2,1,4")
  const [cursor, setCursor] = useState(0)
  const frameCount = readFrames(frameText)
  const pages = readPages(serial)
  const fifo = simulateFifo(pages, frameCount)
  const lru = simulateLru(pages, frameCount)
  const differ = firstEvictionDifference(fifo, lru)
  const step = pages.length === 0 ? 0 : Math.min(cursor, pages.length - 1)
  const hot = differ >= 0 && step === differ
  const fifoStep = fifo[step]
  const lruStep = lru[step]

  return (
    <section data-coach="lab" className="mt-8 rounded-[2px] border border-line bg-card px-5 py-5">
      <p className="text-xs tracking-[0.18em] text-muted">FIFO / LRU</p>
      <p className="mt-3 max-w-2xl text-sm leading-7">默认 3 个页框，访问串 1,2,3,2,1,4。一步步看。这里不会替你按做完了。</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-muted">页框数</span>
          <input
            type="number"
            min={1}
            max={8}
            step={1}
            value={frameText}
            onChange={(event) => {
              setFrameText(event.target.value)
              setCursor(0)
            }}
            className="mt-2 block w-full border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-seal"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">访问串</span>
          <input
            type="text"
            value={serial}
            onChange={(event) => {
              setSerial(event.target.value)
              setCursor(0)
            }}
            className="mt-2 block w-full border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-seal"
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="h-11 rounded-[2px] border border-line px-4 text-sm hover:border-seal disabled:opacity-40"
          disabled={step <= 0}
          onClick={() => setCursor((current) => Math.max(0, current - 1))}
        >
          上一步
        </button>
        <button
          type="button"
          className="h-11 rounded-[2px] bg-seal px-4 text-sm text-paper disabled:opacity-40"
          disabled={pages.length === 0 || step >= pages.length - 1}
          onClick={() => setCursor((current) => current + 1)}
        >
          下一步
        </button>
        <p className="text-sm text-muted">{pages.length === 0 ? "访问串里还没有页号" : `第 ${step + 1} / ${pages.length} 步，访问 ${pages[step]}`}</p>
      </div>
      {pages.length > 0 && (
        <ol className="mt-4 flex flex-wrap gap-2">
          {pages.map((page, index) => (
            <li key={`${page}-${index}`}>
              <button
                type="button"
                aria-current={index === step ? "step" : undefined}
                onClick={() => setCursor(index)}
                className={cn(
                  "h-9 min-w-9 border px-2 text-sm",
                  index === step ? "border-seal bg-seal text-paper" : index === differ ? "border-seal" : "border-line",
                )}
              >
                {page}
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <StepColumn title="FIFO" hint="左起是先进入的" step={fifoStep} hot={hot} />
        <StepColumn title="LRU" hint="左起是更久没用的" step={lruStep} hot={hot} />
      </div>
      {differ >= 0 && fifo[differ] && lru[differ] && (
        <p className="mt-4 text-sm leading-7">
          第一次淘汰不一样在第 {differ + 1} 步。{evictionPhrase("FIFO", fifo[differ].evicted)}，{evictionPhrase("LRU", lru[differ].evicted)}。
        </p>
      )}
    </section>
  )
}
