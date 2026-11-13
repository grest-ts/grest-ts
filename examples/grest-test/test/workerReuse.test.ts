import {callOn, GGTest} from "@grest-ts/testkit"
import {WorkerReuseProbe, WorkerReuseRuntime} from "../src/WorkerReuseRuntime"

// vitest.isolated.config.ts runs this file isolated too; only `isolate: false` reuses a stopped runtime's worker.
const reuse = process.env.GG_TEST_EXPECT_ISOLATED !== "1"

describe("worker reuse: first start", () => {
    GGTest.startWorker(WorkerReuseRuntime)

    test("composes in a fresh worker", async () => {
        expect(await callOn(WorkerReuseProbe).composeRunInWorker()).toBe(1)
    })
})

describe("worker reuse: a describe without runtimes", () => {
    test("leaves parked workers to the next describe", () => {
        expect(true).toBe(true)
    })
})

describe("worker reuse: next describe", () => {
    GGTest.startWorker(WorkerReuseRuntime)

    test("composes again in the previous describe's worker", async () => {
        expect(await callOn(WorkerReuseProbe).composeRunInWorker()).toBe(reuse ? 2 : 1)
    })
})

describe("worker reuse: runtimes started inside tests", () => {
    test("takes the worker the previous describe parked", async () => {
        await GGTest.startWorker(WorkerReuseRuntime)
        expect(await callOn(WorkerReuseProbe).composeRunInWorker()).toBe(reuse ? 3 : 1)
    })

    test("takes the worker the previous test parked", async () => {
        await GGTest.startWorker(WorkerReuseRuntime)
        expect(await callOn(WorkerReuseProbe).composeRunInWorker()).toBe(reuse ? 4 : 1)
    })
})
