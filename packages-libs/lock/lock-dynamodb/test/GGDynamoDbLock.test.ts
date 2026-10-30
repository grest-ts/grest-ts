import {CreateTableCommand} from "@aws-sdk/client-dynamodb"
import {GGTest} from "@grest-ts/testkit"
import type {} from "@grest-ts/db-dynamodb/testkit"
import {sleep} from "@grest-ts/common"
import {GGDynamoDbLock} from "@grest-ts/lock-dynamodb"
import {ENDPOINT, LockDynamoDbTestRuntime, LockTestConfig, TABLE, lock} from "./LockDynamoDbTestRuntime"

describe("GGDynamoDbLock", () => {
    GGTest.startInline(LockDynamoDbTestRuntime)
    GGTest.with(LockTestConfig.db).clone({
        host: {endpoint: ENDPOINT, region: "eu-west-1"},
        setup: async ({client}) => {
            await client.send(new CreateTableCommand({...GGDynamoDbLock.tableDefinition(TABLE), BillingMode: "PAY_PER_REQUEST"}))
        },
    })

    test("concurrent acquires: exactly one owner wins", async () => {
        const wins = await Promise.all(["a", "b", "c", "d", "e"].map(o => lock.acquire("race", o, 10_000)))
        expect(wins.filter(Boolean)).toHaveLength(1)
    })

    test("a held lock is taken over only once it expires; the old holder can no longer renew or release it", async () => {
        expect(await lock.acquire("expiry", "a", 300)).toBe(true)
        expect(await lock.acquire("expiry", "b", 300)).toBe(false)
        expect(await lock.renew("expiry", "a", 300)).toBe(true)

        await sleep(350)
        expect(await lock.renew("expiry", "a", 10_000)).toBe(false)
        expect(await lock.acquire("expiry", "b", 10_000)).toBe(true)
        await lock.release("expiry", "a")
        expect(await lock.acquire("expiry", "c", 10_000)).toBe(false)
    })

    test("release with until keeps the lock taken by no one until then", async () => {
        expect(await lock.acquire("cooldown", "a", 10_000)).toBe(true)
        await lock.release("cooldown", "a", {until: Date.now() + 300})

        expect(await lock.acquire("cooldown", "b", 10_000)).toBe(false)
        expect(await lock.renew("cooldown", "a", 10_000)).toBe(false)
        await sleep(350)
        expect(await lock.acquire("cooldown", "b", 10_000)).toBe(true)
    })

    test("release frees the lock straight away; a release by someone else does nothing", async () => {
        expect(await lock.acquire("free", "a", 10_000)).toBe(true)
        await lock.release("free", "b")
        expect(await lock.acquire("free", "b", 10_000)).toBe(false)

        await lock.release("free", "a")
        expect(await lock.acquire("free", "b", 10_000)).toBe(true)
    })
})
