import {describe, it, expect} from "vitest"
import {DeleteItemCommand, DynamoDBClient, PutItemCommand} from "@aws-sdk/client-dynamodb"
import {GGDynamoDb, type GGDynamoDbCommand} from "../src/GGDynamoDb"

/** A db over a client that answers every command at the serialize step: `fail` names the commands that throw. */
function stubDb(fail: string[] = []) {
    const client = new DynamoDBClient({region: "eu-west-1", endpoint: "http://localhost:1", credentials: {accessKeyId: "local", secretAccessKey: "local"}})
    client.middlewareStack.add((_next, context) => async () => {
        if (fail.includes(context.commandName!)) throw new Error("refused")
        return {output: {$metadata: {}}, response: {}} as never
    }, {step: "serialize"})
    return {db: GGDynamoDb.forClient(client, "test"), client}
}

describe("onSucceeded", () => {
    it("hears each command a raw client sent that succeeded, until unsubscribed", async () => {
        const {db, client} = stubDb(["DeleteItemCommand"])
        const heard: GGDynamoDbCommand[] = []
        const stop = db.onSucceeded(c => heard.push(c))
        await client.send(new PutItemCommand({TableName: "t", Item: {id: {S: "a"}}}))
        await expect(client.send(new DeleteItemCommand({TableName: "t", Key: {id: {S: "a"}}}))).rejects.toThrow("refused")
        stop()
        await client.send(new PutItemCommand({TableName: "t", Item: {id: {S: "b"}}}))
        expect(heard).toEqual([{name: "PutItemCommand", input: {TableName: "t", Item: {id: {S: "a"}}}}])
    })

    it("hears the document client's commands, with plain item values", async () => {
        const {db} = stubDb()
        const heard: GGDynamoDbCommand[] = []
        db.onSucceeded(c => heard.push(c))
        await db.put("t", {id: "a"})
        expect(heard).toEqual([{name: "PutItemCommand", input: {TableName: "t", Item: {id: "a"}}}])
    })

    it("a listener that throws doesn't fail the command, which already happened", async () => {
        const {db, client} = stubDb()
        db.onSucceeded(() => { throw new Error("listener broke") })
        await expect(client.send(new PutItemCommand({TableName: "t", Item: {id: {S: "a"}}}))).resolves.toBeDefined()
    })
})
