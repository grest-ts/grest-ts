<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->


# @grest-ts/lock

A lease lock that a holder renews while it works and that frees itself after its TTL if the holder dies.

```typescript
interface GGLock {
    acquire(lockId: string, owner: string, ttlMs: number): Promise<boolean>
    renew(lockId: string, owner: string, ttlMs: number): Promise<boolean>
    release(lockId: string, owner: string): Promise<void>
}
```

- `acquire` succeeds only when no live lock holds `lockId`, including one held by the same `owner`.
- `renew` extends the lease while `owner` still holds it. `false` means the lock was lost: stop the work.
- `release` does nothing unless `owner` holds the lock, so a holder whose lease expired can't release the lock its successor took.

`owner` identifies the holder and must be unique per process, e.g. hostname + pid + a random suffix.

## Implementations

| Class | Scope |
|---|---|
| `GGInstanceLock` | In memory, one process: single-instance services, development, tests |
| `GGLocatorScopeLock` | In memory, one `GGLocatorScope` (e.g. isolated per test) |
| `GGJobDynamoDbLock` ([`@grest-ts/job-dynamodb`](@pkg/job-dynamodb)) | Shared across instances through DynamoDB |

With several instances, only a shared-store implementation actually excludes anyone: an in-memory lock lets every instance "acquire" it.

```typescript
const owner = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`
if (await lock.acquire("rebuild-index", owner, 30_000)) {
    try {
        await rebuildIndex()
    } finally {
        await lock.release("rebuild-index", owner)
    }
}
```

For recurring work, [`@grest-ts/job`](@pkg/job) does the acquiring, renewing and releasing for you.
