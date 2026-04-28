/**
 * Wire-log integration test for the WS production client.
 *
 * Exercises the per-client `logMode` option across modes (ALL / NON_OK / OFF)
 * and checks that lifecycle + frame events flow through `GGLog` as expected.
 *
 * `GGTest.startWorker(MainRuntime)` runs the server in another process, so
 * the client and the wire-log emitter both run in the test process — logs
 * go through the test-root `GGLog` instance set up by testkit-vitest.
 */

import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {GGWsLogMode} from "@grest-ts/websocket"
import {GGLog, type GGLogger, type LogEntry, LogLevel} from "@grest-ts/logger"
import {MainRuntime} from "../src/main"
import {ClientTestSocketApi} from "../src/api/ClientTestSocketApi"

class CapturingLogger implements GGLogger {
    public readonly minLevel = LogLevel.DEBUG
    public readonly entries: LogEntry[] = []
    public log(entry: LogEntry): void {
        this.entries.push(entry)
    }
    public clear(): void {
        this.entries.length = 0
    }
    public ofKind(kind: string): LogEntry[] {
        return this.entries.filter(e => (e.data as any)?.kind === kind)
    }
}

function clientUrl(apiName: string = "ClientTestSocketApi"): string {
    return GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl(apiName)
}

describe.sequential("WS wire-log (createClient)", () => {

    GGTest.startWorker(MainRuntime)

    const captured = new CapturingLogger()
    GGLog.add(captured)

    /**
     * Snapshot helper: returns a function that yields only the entries
     * appearing AFTER it was created. Necessary because previous tests' WS
     * `disconnect()` can fire `onClose` asynchronously, landing in the
     * next test's window — `clear()` alone is racy.
     */
    function startWindow(): () => LogEntry[] {
        const baseline = captured.entries.length
        return () => captured.entries.slice(baseline)
    }

    /** Drain any in-flight async lifecycle events before reading entries. */
    const drain = () => new Promise(r => setTimeout(r, 50))

    test("ALL mode logs outgoing call at INFO with payload", async () => {
        const window = startWindow()
        const client = ClientTestSocketApi.createClient({url: clientUrl(), logMode: GGWsLogMode.ALL})
        await client.connect()
        try {
            await client.outgoing.echo({message: "hello"})
            await drain()

            const outgoing = window().filter(e => (e.data as any)?.kind === "outgoing")
            expect(outgoing.length).toBeGreaterThanOrEqual(1)
            const entry = outgoing[0]
            expect(entry.level).toBe(LogLevel.INFO)
            expect(entry.message).toBe("ws→ ClientTestSocketApi.echo")
            expect((entry.data as any)?.methodName).toBe("echo")
            expect((entry.data as any)?.payload).toEqual({message: "hello"})
        } finally {
            await client.disconnect()
        }
    })

    test("ALL mode logs lifecycle: open then final-close", async () => {
        const window = startWindow()
        const client = ClientTestSocketApi.createClient({url: clientUrl(), logMode: GGWsLogMode.ALL})
        await client.connect()
        await client.disconnect()
        await drain()

        const entries = window()
        expect(entries.filter(e => (e.data as any)?.kind === "open").length).toBeGreaterThanOrEqual(1)
        expect(entries.filter(e => (e.data as any)?.kind === "final-close").length).toBeGreaterThanOrEqual(1)
    })

    test("OFF mode emits no wire-log entries", async () => {
        const window = startWindow()
        const client = ClientTestSocketApi.createClient({url: clientUrl(), logMode: GGWsLogMode.OFF})
        await client.connect()
        try {
            await client.outgoing.echo({message: "silent"})
        } finally {
            await client.disconnect()
        }
        await drain()

        const wireEntries = window().filter(e => (e.data as any)?.schemaName === "ClientTestSocketApi")
        expect(wireEntries).toHaveLength(0)
    })

    test("NON_OK mode skips routine outgoing traffic", async () => {
        const window = startWindow()
        const client = ClientTestSocketApi.createClient({url: clientUrl(), logMode: GGWsLogMode.NON_OK})
        await client.connect()
        try {
            await client.outgoing.echo({message: "hello"})
            await drain()
            const outgoingEntries = window().filter(e => (e.data as any)?.kind === "outgoing")
            expect(outgoingEntries).toHaveLength(0)
        } finally {
            await client.disconnect()
        }
    })

    test("NON_OK mode skips routine lifecycle (open / manual close)", async () => {
        const window = startWindow()
        const client = ClientTestSocketApi.createClient({url: clientUrl(), logMode: GGWsLogMode.NON_OK})
        await client.connect()
        await client.disconnect()
        await drain()

        const entries = window()
        expect(entries.filter(e => (e.data as any)?.kind === "open")).toHaveLength(0)
        expect(entries.filter(e => (e.data as any)?.kind === "close")).toHaveLength(0)
        const manualFinalCloses = entries.filter(e =>
            (e.data as any)?.kind === "final-close" && (e.data as any)?.reason === "manual"
        )
        expect(manualFinalCloses).toHaveLength(0)
    })
})
