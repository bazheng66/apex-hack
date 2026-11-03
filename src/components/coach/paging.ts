export interface PagingStep {
  index: number
  page: number
  frames: number[]
  evicted: number | null
  fault: boolean
}

function step(index: number, page: number, frames: number[], evicted: number | null, fault: boolean): PagingStep {
  return { index, page, frames: [...frames], evicted, fault }
}

export function simulateFifo(pages: number[], frameCount: number): PagingStep[] {
  const frames: number[] = []
  return pages.map((page, index) => {
    if (frames.includes(page)) return step(index, page, frames, null, false)
    let evicted: number | null = null
    if (frames.length >= frameCount) evicted = frames.shift() ?? null
    frames.push(page)
    return step(index, page, frames, evicted, true)
  })
}

export function simulateLru(pages: number[], frameCount: number): PagingStep[] {
  const frames: number[] = []
  return pages.map((page, index) => {
    const at = frames.indexOf(page)
    if (at >= 0) {
      frames.splice(at, 1)
      frames.push(page)
      return step(index, page, frames, null, false)
    }
    let evicted: number | null = null
    if (frames.length >= frameCount) evicted = frames.shift() ?? null
    frames.push(page)
    return step(index, page, frames, evicted, true)
  })
}

export function firstEvictionDifference(left: PagingStep[], right: PagingStep[]): number {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index]?.evicted !== right[index]?.evicted) return index
  }
  return -1
}
