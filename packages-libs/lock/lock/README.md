<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/lock

Lease locks: a holder takes a lock for a TTL and renews it while it works. If the holder dies, the lock frees itself when the lease runs out.

```typescript
interface GGLock {
    acquire(lockId: string, owner: string, ttlMs: number): Promise<boolean>
    renew(lockId: string, owner: string, ttlMs: number): Promise<boolean>
    release(lockId: string, owner: string): Promise<void>
}
```

- A lease is held until acquire (or renew) time + `ttlMs`. From that instant it has expired, whether or not anyone took it since.
- `acquire` succeeds only when no live lease holds `lockId`, including one held by the same `owner`.
- `renew` extends the lease while `owner` still holds it. `false` means the lock was lost: stop the work.
- `release` does nothing unless `owner` holds the lock, so a holder whose lease expired can't release its successor's lock.

`owner` must be unique per process; `newLockOwner()` gives hostname + pid + a random suffix.

## withLock

`withLock` acquires, renews every `ttlMs / 3`, and releases, and aborts the work when the lock is lost. It runs inside a `GGLocatorScope` (any runtime code does):

```typescript
import {newLockOwner, withLock} from "@grest-ts/lock"

const owner = newLockOwner()

const result = await withLock(lock, "rebuild-index", {owner, ttlMs: 30_000}, async signal => {
    await rebuildIndex(signal)
})
// "DONE", "BUSY" (someone else holds it; the function never ran) or "LOST"
```

The lock is lost when a renew answers `false`, or when no renew has succeeded for two thirds of the TTL. The function's `signal` then aborts and the lock is not released: someone else may already hold it. The function must stop at the signal for the lock to protect anything. Options:

- `signal`: aborts the work from outside, e.g. on shutdown.
- `holdUntil`: after the function completes, the lease is renewed to last until then instead of released, so nobody acquires the lock before: a cooldown. Not applied when the function threw or was aborted.

For recurring work, [`@grest-ts/job`](@pkg/job) builds on this.

## Implementations

| Class | Shared by |
|---|---|
| `GGInstanceLock` | One process: single-instance services, development, tests |
| `GGLocatorScopeLock` | One `GGLocatorScope`, e.g. isolated per test |
| `GGDynamoDbLock` ([`@grest-ts/lock-dynamodb`](@pkg/lock-dynamodb)) | Every instance using the same DynamoDB table |

With several instances, only a shared store excludes anyone: an in-memory lock lets every instance "acquire" it.

## Writing a Lock

Implement `GGLock` on a store with atomic conditional writes, such as Redis `SET NX PX` with an owner check in Lua, a SQL `UPDATE ... WHERE`, or a DynamoDB condition expression. Every call must be a single atomic operation:

- `acquire`: write `{owner, lockedUntil: now + ttl}` if the row is missing or `lockedUntil <= now`.
- `renew`: write a new `lockedUntil` if `owner` matches and `lockedUntil > now`.
- `release`: delete the row if `owner` matches.

Give rows of crashed holders a way to disappear (a TTL, or a cleanup), since nobody releases them. A lock still does not fence: a holder paused past its TTL keeps running until its next renew. Make the work under it idempotent.
