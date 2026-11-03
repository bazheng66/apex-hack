import { describe, expect, it } from "vitest"
import { firstEvictionDifference, simulateFifo, simulateLru } from "./paging.ts"

describe("page replacement", () => {
  it("evicts 1 with FIFO and 3 with LRU when 4 arrives in three frames", () => {
    const pages = [1, 2, 3, 2, 1, 4]
    const fifo = simulateFifo(pages, 3)
    const lru = simulateLru(pages, 3)

    expect(fifo).toEqual([
      { index: 0, page: 1, frames: [1], evicted: null, fault: true },
      { index: 1, page: 2, frames: [1, 2], evicted: null, fault: true },
      { index: 2, page: 3, frames: [1, 2, 3], evicted: null, fault: true },
      { index: 3, page: 2, frames: [1, 2, 3], evicted: null, fault: false },
      { index: 4, page: 1, frames: [1, 2, 3], evicted: null, fault: false },
      { index: 5, page: 4, frames: [2, 3, 4], evicted: 1, fault: true },
    ])
    expect(lru).toEqual([
      { index: 0, page: 1, frames: [1], evicted: null, fault: true },
      { index: 1, page: 2, frames: [1, 2], evicted: null, fault: true },
      { index: 2, page: 3, frames: [1, 2, 3], evicted: null, fault: true },
      { index: 3, page: 2, frames: [1, 3, 2], evicted: null, fault: false },
      { index: 4, page: 1, frames: [3, 2, 1], evicted: null, fault: false },
      { index: 5, page: 4, frames: [2, 1, 4], evicted: 3, fault: true },
    ])
    expect(fifo[5]?.evicted).toBe(1)
    expect(lru[5]?.evicted).toBe(3)
    expect(firstEvictionDifference(fifo, lru)).toBe(5)
  })
})
