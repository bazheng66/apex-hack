import { describe, expect, it } from "vitest"
import { firstDifferentEviction, simulateFifo, simulateLru } from "./paging.ts"

const reference = [1, 2, 3, 2, 1, 4]

describe("page replacement", () => {
  it("evicts 1 under FIFO and 3 under LRU when 4 arrives in three frames", () => {
    expect(simulateFifo(3, reference)).toEqual([
      { index: 0, page: 1, frames: [1], evicted: null, fault: true },
      { index: 1, page: 2, frames: [1, 2], evicted: null, fault: true },
      { index: 2, page: 3, frames: [1, 2, 3], evicted: null, fault: true },
      { index: 3, page: 2, frames: [1, 2, 3], evicted: null, fault: false },
      { index: 4, page: 1, frames: [1, 2, 3], evicted: null, fault: false },
      { index: 5, page: 4, frames: [2, 3, 4], evicted: 1, fault: true },
    ])
    expect(simulateLru(3, reference)).toEqual([
      { index: 0, page: 1, frames: [1], evicted: null, fault: true },
      { index: 1, page: 2, frames: [1, 2], evicted: null, fault: true },
      { index: 2, page: 3, frames: [1, 2, 3], evicted: null, fault: true },
      { index: 3, page: 2, frames: [1, 3, 2], evicted: null, fault: false },
      { index: 4, page: 1, frames: [3, 2, 1], evicted: null, fault: false },
      { index: 5, page: 4, frames: [2, 1, 4], evicted: 3, fault: true },
    ])
    expect(firstDifferentEviction(3, reference)).toEqual({ index: 5, fifo: 1, lru: 3 })
  })

  it("updates LRU recency on a hit and leaves FIFO order alone", () => {
    const pages = [1, 2, 1, 3]
    expect(simulateFifo(2, pages)[2]).toEqual({ index: 2, page: 1, frames: [1, 2], evicted: null, fault: false })
    expect(simulateLru(2, pages)[2]).toEqual({ index: 2, page: 1, frames: [2, 1], evicted: null, fault: false })
    expect(firstDifferentEviction(2, pages)).toEqual({ index: 3, fifo: 1, lru: 2 })
  })

  it("returns null when every eviction agrees, including null against null", () => {
    expect(firstDifferentEviction(3, [1, 2, 3, 4])).toBeNull()
    expect(firstDifferentEviction(3, [])).toBeNull()
    expect(simulateFifo(1, [1, 1])[1]).toMatchObject({ fault: false, evicted: null, frames: [1] })
  })

  it("does not let a later step mutate an earlier frame list", () => {
    const steps = simulateFifo(3, [1, 2, 3])
    steps[0]?.frames.push(99)
    expect(steps[1]?.frames).toEqual([1, 2])
  })
})
