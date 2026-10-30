import {CreateTableCommand, DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {GGJobDynamoDbLock} from "@grest-ts/job-dynamodb"

const ENDPOINT = process.env.DYNAMODB_TEST_ENDPOINT ?? "http://localhost:8001"
// dynamodb-local namespaces tables by access key, so each run gets its own.
const raw = new DynamoDBClient({endpoint: ENDPOINT, region: "eu-west-1", credentials: {accessKeyId: `job${Date.now().toString(36)}`, secretAccessKey: "x"}})
const clock = {t: 1_000_000}
const lock = new GGJobDynamoDbLock({getRawClient: () => raw}, {tableName: "job-locks", now: () => clock.t})

beforeAll(async () => {
    await raw.send(new CreateTableCommand({...GGJobDynamoDbLock.tableDefinition("job-locks"), BillingMode: "PAY_PER_REQUEST"}))
})

describe("GGJobDynamoDbLock", () => {
    test("concurrent acquires: exactly one owner wins", async () => {
        const wins = await Promise.all(["a", "b", "c", "d", "e"].map(o => lock.acquire("race", o, 10_000)))
        expect(wins.filter(Boolean)).toHaveLength(1)
    })

    test("a held lock is taken over only once it expires; the old holder can no longer renew or release it", async () => {
        expect(await lock.acquire("expiry", "a", 10_000)).toBe(true)
        expect(await lock.acquire("expiry", "b", 10_000)).toBe(false)
        expect(await lock.renew("expiry", "a", 10_000)).toBe(true)

        clock.t += 10_001
        expect(await lock.acquire("expiry", "b", 10_000)).toBe(true)
        expect(await lock.renew("expiry", "a", 10_000)).toBe(false)
        await lock.release("expiry", "a")
        expect(await lock.acquire("expiry", "c", 10_000)).toBe(false)
    })

    test("a release with ranAt records the run; the next acquire waits until it is due", async () => {
        expect(await lock.acquire("due", "a", 10_000, clock.t - 60_000)).toBe(true)
        const ranAt = clock.t
        await lock.release("due", "a", ranAt)

        expect(await lock.acquire("due", "b", 10_000, ranAt - 1)).toBe(false)
        expect(await lock.acquire("due", "b", 10_000, ranAt)).toBe(true)
    })

    test("a release without ranAt drops the row, so the next acquire is due straight away", async () => {
        expect(await lock.acquire("drop", "a", 10_000, clock.t)).toBe(true)
        await lock.release("drop", "a", clock.t)
        expect(await lock.acquire("drop", "b", 10_000, clock.t)).toBe(true)
        await lock.release("drop", "b")

        expect(await lock.acquire("drop", "c", 10_000, 0)).toBe(true)
    })
})
