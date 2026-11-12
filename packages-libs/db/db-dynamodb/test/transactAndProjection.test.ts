import {describe, it, expect} from "vitest"
import {IsNumber, IsObject, IsString} from "@grest-ts/schema"
import {GGDynamoDbTableSpec} from "../src/GGDynamoDbTableSpec"
import {stubDb} from "./typedTableTestUtils"

const cancelled = (...codes: string[]) => Object.assign(new Error("cancelled"), {name: "TransactionCanceledException", CancellationReasons: codes.map(Code => ({Code}))})

describe("transactWrite", () => {
    it("is not ok when only conditions cancelled it, naming those items", async () => {
        const {db} = stubDb(cancelled("None", "ConditionalCheckFailed"))
        await expect(db.transactWrite([])).resolves.toEqual({ok: false, conditionFailed: [1]})
    })

    it("rethrows any other cancellation reason, beside a failed condition too", async () => {
        const {db} = stubDb(cancelled("ConditionalCheckFailed", "TransactionConflict"), cancelled("ThrottlingError", "None"))
        await expect(db.transactWrite([])).rejects.toMatchObject({name: "TransactionCanceledException"})
        await expect(db.transactWrite([])).rejects.toMatchObject({name: "TransactionCanceledException"})
    })
})

const IsNode = IsObject({runKey: IsString, nodeId: IsString, runId: IsString, workKey: IsString.orUndefined, wakeAt: IsNumber})

describe("an INCLUDE projection", () => {
    it("keeps the attributes it names, a table key included, and lists retired ones after them", () => {
        const Spec = GGDynamoDbTableSpec.define({
            name: "nodes", schema: IsNode, pk: "runKey", sk: "nodeId",
            indexes: {
                work: {name: "work-index", pk: "workKey", sk: "wakeAt", projection: ["nodeId", "runId", "workKey"]},
                retired: {name: "retired-index", pk: "runId", projection: "KEYS_ONLY", retiredAttributes: ["status"]},
            },
        })
        const projections = Object.fromEntries(Spec.createTableInput().GlobalSecondaryIndexes!.map(i => [i.IndexName, i.Projection]))
        expect(projections["work-index"]).toEqual({ProjectionType: "INCLUDE", NonKeyAttributes: ["nodeId", "runId"]})
        expect(projections["retired-index"]).toEqual({ProjectionType: "INCLUDE", NonKeyAttributes: ["status"]})
    })

    it("refuses a retired attribute the spec still has", () => {
        expect(() => GGDynamoDbTableSpec.define({name: "nodes", schema: IsNode, pk: "runKey", indexes: {byRun: {pk: "runId", projection: ["nodeId"], retiredAttributes: ["wakeAt"]}}}))
            .toThrow(/index "byRun" lists "wakeAt" as retired, but the spec has it/)
    })
})
