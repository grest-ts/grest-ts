import {describe, it, expect, vi} from "vitest"
import {drainPages, type GGDynamoDbPage} from "../src/GGDynamoDb"

/** Stands in for DynamoDB's paging: hands out `perPage` rows at a time and
 *  carries a cursor while rows remain — the shape a 1MB response boundary has. */
function pagedSource(total: number, perPage: number) {
    const rows = Array.from({length: total}, (_, i) => i)
    const fetch = vi.fn(async (cursor: string | undefined): Promise<GGDynamoDbPage<number>> => {
        const start = cursor === undefined ? 0 : Number(cursor)
        const items = rows.slice(start, start + perPage)
        const next = start + items.length
        return {items, cursor: next < rows.length ? String(next) : undefined}
    })
    return fetch
}

describe("drainPages", () => {
    // The bug this exists for: one DynamoDB Query response is capped at 1MB and
    // returns LastEvaluatedKey rather than erroring, so a single command silently
    // returns a prefix of the matches.
    it("returns every row across page boundaries", async () => {
        const fetch = pagedSource(250, 100)
        await expect(drainPages(fetch, undefined, "test")).resolves.toHaveLength(250)
        expect(fetch).toHaveBeenCalledTimes(3)
    })

    it("returns a single page without asking for another", async () => {
        const fetch = pagedSource(10, 100)
        await expect(drainPages(fetch, undefined, "test")).resolves.toHaveLength(10)
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it("threads each page's cursor into the next request", async () => {
        const fetch = pagedSource(5, 2)
        await drainPages(fetch, undefined, "test")
        expect(fetch.mock.calls.map(c => c[0])).toEqual([undefined, "2", "4"])
    })

    it("stops at an explicit limit", async () => {
        const fetch = pagedSource(1_000, 10)
        await expect(drainPages(fetch, 25, "test")).resolves.toHaveLength(25)
    })

    it("shrinks the per-request limit as pages accumulate", async () => {
        // A fixed Limit would ask for 10 more on page two and overshoot to 20.
        const fetch = vi.fn(async (): Promise<GGDynamoDbPage<number>> => ({items: [1, 2, 3], cursor: "more"}))
        await drainPages(() => fetch(), 10, "test")
        expect(fetch).toHaveBeenCalledTimes(4)
    })

    it("throws past the cap rather than loading an unbounded result", async () => {
        // Loud failure beats both a silent prefix and an OOM.
        const fetch = vi.fn(async (): Promise<GGDynamoDbPage<number>> => ({items: Array(5_000).fill(0), cursor: "more"}))
        await expect(drainPages(fetch, undefined, "listChats")).rejects.toThrow(/listChats exceeded 10000 rows/)
    })

    it("does not cap a caller that asked for a bounded page", async () => {
        const fetch = pagedSource(50_000, 1_000)
        await expect(drainPages(fetch, 20_000, "test")).resolves.toHaveLength(20_000)
    })

    it("keeps following an empty page that still carries a cursor", async () => {
        // DynamoDB can return zero rows and a cursor when a page is consumed by
        // a filter; treating empty as the end would silently truncate.
        const pages: Array<GGDynamoDbPage<number>> = [
            {items: [], cursor: "a"},
            {items: [], cursor: "b"},
            {items: [7], cursor: undefined},
        ]
        const fetch = vi.fn(async () => pages.shift()!)
        await expect(drainPages(fetch, undefined, "test")).resolves.toEqual([7])
    })
})
