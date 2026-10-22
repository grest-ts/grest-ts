import {describe, it, expect, vi} from "vitest"
import {GetCommand} from "@aws-sdk/lib-dynamodb"
import {GGDynamoDb} from "../src/GGDynamoDb"

describe("GGDynamoDb.get", () => {
    it("reads strongly consistent", async () => {
        const send = vi.fn(async (_cmd: GetCommand) => ({Item: {id: "a"}}))
        const db = Object.assign(Object.create(GGDynamoDb.prototype), {client: {send}}) as GGDynamoDb

        await expect(db.get("t", {id: "a"})).resolves.toEqual({id: "a"})
        expect(send.mock.calls[0][0].input).toEqual({TableName: "t", Key: {id: "a"}, ConsistentRead: true})
    })
})
