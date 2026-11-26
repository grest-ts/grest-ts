/**
 * Page wake in a browser drives every reconnecting client: the tab or the network coming back or a resume
 * probe the link and reconnect a dead one; a back/forward-cache restore reconnects at once. The page is
 * stubbed with EventTargets before the first client installs the detector.
 */

import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {MainRuntime} from "../src/main"
import {ClientTestSocketApi} from "../src/api/ClientTestSocketApi"
import {freezableProxy} from "./freezableProxy"

const page = Object.assign(new EventTarget(), {hidden: false})
const win = new EventTarget()
Object.assign(globalThis, {document: page, window: win})

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const clientUrl = () => GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("ClientTestSocketApi")

async function connected(opts: {url?: string, pageWake?: boolean} = {}) {
    let setupRuns = 0
    const client = ClientTestSocketApi.createClient({
        url: opts.url ?? clientUrl(),
        reconnect: {initialDelayMs: 10, pageWake: opts.pageWake},
    })
    await client.connect(() => { setupRuns++ })
    return {client, setupRuns: () => setupRuns}
}

describe("page wake", () => {

    GGTest.startWorker(MainRuntime)

    test("a back/forward-cache restore reconnects every client and re-runs its setup; a fresh page load doesn't", async () => {
        const a = await connected()
        const b = await connected()
        try {
            win.dispatchEvent(Object.assign(new Event("pageshow"), {persisted: false}))
            await wait(100)
            expect([a.setupRuns(), b.setupRuns()]).toEqual([1, 1])
            win.dispatchEvent(Object.assign(new Event("pageshow"), {persisted: true}))
            await vi.waitFor(() => expect([a.setupRuns(), b.setupRuns()]).toEqual([2, 2]))
            expect(await a.client.outgoing.echo({message: "awake"})).toEqual({message: "awake", echoedBy: "server"})
        } finally {
            await a.client.disconnect()
            await b.client.disconnect()
        }
    })

    const checks: [string, () => void][] = [
        ["the tab coming back", () => page.dispatchEvent(new Event("visibilitychange"))],
        ["the network coming back", () => win.dispatchEvent(new Event("online"))],
        ["a resume", () => page.dispatchEvent(new Event("resume"))],
    ]
    for (const [name, wake] of checks) {
        test(`${name} probes: a dead link reconnects`, async () => {
            const proxy = await freezableProxy(clientUrl())
            const c = await connected({url: proxy.url})
            try {
                proxy.freeze()
                wake()
                await vi.waitFor(() => expect(c.setupRuns()).toBe(2), {timeout: 5_000})
            } finally {
                await c.client.disconnect()
                await proxy.close()
            }
        }, 10_000)
    }

    test("a probe keeps a live link, however many wake events fire", async () => {
        const c = await connected()
        try {
            for (const [, wake] of checks) wake()
            await wait(3_300)
            expect(c.setupRuns()).toBe(1)
            expect(c.client.isConnected).toBe(true)
        } finally {
            await c.client.disconnect()
        }
    }, 10_000)

    test("pageWake: false opts out; a closed client stops listening", async () => {
        const off = await connected({pageWake: false})
        const closed = await connected()
        await closed.client.disconnect()
        try {
            win.dispatchEvent(Object.assign(new Event("pageshow"), {persisted: true}))
            await wait(200)
            expect(off.setupRuns()).toBe(1)
            expect(closed.setupRuns()).toBe(1)
        } finally {
            await off.client.disconnect()
        }
    })
})
