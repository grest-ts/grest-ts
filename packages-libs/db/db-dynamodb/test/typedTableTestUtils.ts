import {vi} from "vitest"
import {GGDynamoDb} from "../src/GGDynamoDb"

/** A GGDynamoDb whose SDK client answers with `responses` in turn (an Error is thrown), recording each command's input. */
export function stubDb(...responses: (Record<string, unknown> | Error)[]) {
    const send = vi.fn(async (_command: {input: Record<string, any>}) => {
        const response = responses.shift() ?? {Items: []}
        if (response instanceof Error) throw response
        return response
    })
    const db = Object.create(GGDynamoDb.prototype) as GGDynamoDb
    Object.assign(db, {client: {send}, config: {name: "test"}})
    return {db, inputs: () => send.mock.calls.map(c => c[0].input)}
}

/** Resolves the placeholders, so assertions read like the expression a person would write. */
export function readable(input: Record<string, any>, expression: string): string {
    return expression
        .replace(/#n\d+/g, n => input.ExpressionAttributeNames[n])
        .replace(/:v\d+/g, v => JSON.stringify(input.ExpressionAttributeValues[v], (_k, x) => x instanceof Set ? {set: [...x]} : x))
}

/** Type assertions (`@ts-expect-error`) on calls that mustn't run. */
export function typeOnly(_fn: () => void) {}
