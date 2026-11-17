import {describe, it, expect} from "vitest"
import {DeleteItemCommand, PutItemCommand} from "@aws-sdk/client-dynamodb"
import {GGDynamoDb, type GGDynamoDbCommand} from "../src/GGDynamoDb"

/** A GGDynamoDb whose raw clients answer every command at the serialize step: `fail` names the commands that throw. */
function stubDb(fail: string[] = []) {
    const db = Object.create(GGDynamoDb.prototype) as GGDynamoDb
    Object.assign(db, {
        config: {name: "test", host: {get: () => ({region: "eu-west-1", endpoint: "http://localhost:1"})}, user: {reveal: () => undefined}},
        succeeded: new Set(),
    })
    const raw = () => {
        const client = db.getRawClient()
        client.middlewareStack.add((_next, context) => async () => {
            if (fail.includes(context.commandName!)) throw new Error("refused")
            return {output: {$metadata: {}}, response: {}} as never
        }, {step: "serialize"})
        return client
    }
    return {db, raw}
}

describe("onSucceeded", () => {
    it("hears each command a raw client sent that succeeded, until unsubscribed", async () => {
        const {db, raw} = stubDb(["DeleteItemCommand"])
        const heard: GGDynamoDbCommand[] = []
        const stop = db.onSucceeded(c => heard.push(c))
        const client = raw()
        await client.send(new PutItemCommand({TableName: "t", Item: {id: {S: "a"}}}))
        await expect(client.send(new DeleteItemCommand({TableName: "t", Key: {id: {S: "a"}}}))).rejects.toThrow("refused")
        stop()
        await client.send(new PutItemCommand({TableName: "t", Item: {id: {S: "b"}}}))
        expect(heard).toEqual([{name: "PutItemCommand", input: {TableName: "t", Item: {id: {S: "a"}}}}])
    })

    it("a listener that throws doesn't fail the command, which already happened", async () => {
        const {db, raw} = stubDb()
        db.onSucceeded(() => { throw new Error("listener broke") })
        await expect(raw().send(new PutItemCommand({TableName: "t", Item: {id: {S: "a"}}}))).resolves.toBeDefined()
    })
})
