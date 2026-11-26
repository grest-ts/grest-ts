/**
 * Page wake in a browser drives every reconnecting client: the tab coming back, the network coming back or
 * a clock jump probe the link; resume and a back/forward-cache restore reconnect at once. The page is
 * stubbed with EventTargets before the first client installs the detector.
 */

import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {MainRuntime} from "../src/main"
import {ClientTestSocketApi} from "../src/api/ClientTestSocketApi"

const page = Object.assign(new EventTarget(), {hidden: false})
const win = new EventTarget()
Object.assign(globalThis, {document: page, window: win})

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const clientUrl = () => GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("ClientTestSocketApi")
/** Past the detector's debounce, so the next event of the same kind fires. */
const pastDebounce = () => wait(5_100)

async function connected(opts: {pageWake?: boolean} = {}) {
    let setupRuns = 0
    const client = ClientTestSocketApi.createClient({url: clientUrl(), reconnect: {initialDelayMs: 10, ...opts}})
    await client.connect(() => { setupRuns++ })
    return {client, setupRuns: () => setupRuns}
}

describe("page wake", () => {

    GGTest.startWorker(MainRuntime)

    test("resume reconnects every client and re-runs its setup", async () => {
        const a = await connected()
        const b = await connected()
        try {
            page.dispatchEvent(new Event("resume"))
            await vi.waitFor(() => expect([a.setupRuns(), b.setupRuns()]).toEqual([2, 2]))
            expect(await a.client.outgoing.echo({message: "awake"})).toEqual({message: "awake", echoedBy: "server"})
        } finally {
            await a.client.disconnect()
            await b.client.disconnect()
        }
    })

    test("a back/forward-cache restore reconnects; a fresh page load doesn't", async () => {
        await pastDebounce()
        const c = await connected()
        try {
            win.dispatchEvent(Object.assign(new Event("pageshow"), {persisted: false}))
            await wait(100)
            expect(c.setupRuns()).toBe(1)
            win.dispatchEvent(Object.assign(new Event("pageshow"), {persisted: true}))
            await vi.waitFor(() => expect(c.setupRuns()).toBe(2))
        } finally {
            await c.client.disconnect()
        }
    }, 10_000)

    test("the tab or the network coming back keeps a live link (probe answered)", async () => {
        const c = await connected()
        try {
            page.dispatchEvent(new Event("visibilitychange"))
            win.dispatchEvent(new Event("online"))
            await wait(3_300)
            expect(c.setupRuns()).toBe(1)
            expect(c.client.isConnected).toBe(true)
        } finally {
            await c.client.disconnect()
        }
    }, 10_000)

    test("pageWake: false opts out; a closed client stops listening", async () => {
        await pastDebounce()
        const off = await connected({pageWake: false})
        const closed = await connected()
        await closed.client.disconnect()
        try {
            page.dispatchEvent(new Event("resume"))
            await wait(200)
            expect(off.setupRuns()).toBe(1)
            expect(closed.setupRuns()).toBe(1)
        } finally {
            await off.client.disconnect()
        }
    }, 10_000)
})
