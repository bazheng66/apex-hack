export interface PageStep {
  index: number
  page: number
  frames: number[]
  evicted: number | null
  fault: boolean
}

function simulate(frameCount: number, pages: readonly number[], touchOnHit: boolean): PageStep[] {
  const memory: number[] = []
  const steps: PageStep[] = []
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index] ?? 0
    const at = memory.indexOf(page)
    if (at >= 0) {
      if (touchOnHit) {
        memory.splice(at, 1)
        memory.push(page)
      }
      steps.push({ index, page, frames: [...memory], evicted: null, fault: false })
      continue
    }
    let evicted: number | null = null
    if (frameCount > 0 && memory.length >= frameCount) evicted = memory.shift() ?? null
    if (frameCount > 0) memory.push(page)
    steps.push({ index, page, frames: [...memory], evicted, fault: true })
  }
  return steps
}

export function simulateFifo(frameCount: number, pages: readonly number[]): PageStep[] {
  return simulate(frameCount, pages, false)
}

export function simulateLru(frameCount: number, pages: readonly number[]): PageStep[] {
  return simulate(frameCount, pages, true)
}

export function firstDifferentEviction(
  frameCount: number,
  pages: readonly number[],
): { index: number; fifo: number | null; lru: number | null } | null {
  const fifoTrace = simulateFifo(frameCount, pages)
  const lruTrace = simulateLru(frameCount, pages)
  const steps = Math.min(fifoTrace.length, lruTrace.length)
  for (let index = 0; index < steps; index += 1) {
    const fifo = fifoTrace[index]?.evicted ?? null
    const lru = lruTrace[index]?.evicted ?? null
    if (fifo !== lru) return { index, fifo, lru }
  }
  return null
}
