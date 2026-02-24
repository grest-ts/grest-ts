import {describe, it, expect} from 'vitest';
import {GGLocatorScopeLock} from './GGLocatorScopeLock';
import {GGLocatorScope} from '@grest-ts/locator';

/**
 * Helper to run test code within a GGLocatorScope.
 */
async function runInScope<T>(fn: () => Promise<T>): Promise<T> {
    const scope = new GGLocatorScope('test');
    return scope.run(fn);
}

describe('GGContextLock', () => {
    describe('acquire', () => {
        it('should acquire lock when not held', async () => {
            await runInScope(async () => {
                const lock = new GGLocatorScopeLock();
                const result = await lock.acquire('test-lock', 5000);
                expect(result).toBe(true);
            });
        });

        it('should fail to acquire when already held in same context', async () => {
            await runInScope(async () => {
                const lock = new GGLocatorScopeLock();
                await lock.acquire('test-lock', 5000);
                const result = await lock.acquire('test-lock', 5000);
                expect(result).toBe(false);
            });
        });

        it('should allow acquiring different locks in same context', async () => {
            await runInScope(async () => {
                const lock = new GGLocatorScopeLock();
                const result1 = await lock.acquire('lock-1', 5000);
                const result2 = await lock.acquire('lock-2', 5000);
                expect(result1).toBe(true);
                expect(result2).toBe(true);
            });
        });

        it('should acquire expired lock', async () => {
            await runInScope(async () => {
                const lock = new GGLocatorScopeLock();
                await lock.acquire('test-lock', 50);

                // Wait for expiry
                await new Promise(r => setTimeout(r, 100));

                const result = await lock.acquire('test-lock', 5000);
                expect(result).toBe(true);
            });
        });

        it('should share lock state with multiple GGContextLock instances in same scope', async () => {
            await runInScope(async () => {
                const lock1 = new GGLocatorScopeLock();
                const lock2 = new GGLocatorScopeLock();

                await lock1.acquire('test-lock', 5000);

                // Same scope, different instance - should see the lock
                const result = await lock2.acquire('test-lock', 5000);
                expect(result).toBe(false);
            });
        });
    });

    describe('renew', () => {
        it('should renew held lock', async () => {
            await runInScope(async () => {
                const lock = new GGLocatorScopeLock();
                await lock.acquire('test-lock', 5000);
                const result = await lock.renew('test-lock', 5000);
                expect(result).toBe(true);
            });
        });

        it('should fail to renew non-existent lock', async () => {
            await runInScope(async () => {
                const lock = new GGLocatorScopeLock();
                const result = await lock.renew('non-existent', 5000);
                expect(result).toBe(false);
            });
        });

        it('should fail to renew expired lock', async () => {
            await runInScope(async () => {
                const lock = new GGLocatorScopeLock();
                await lock.acquire('test-lock', 50);

                // Wait for expiry
                await new Promise(r => setTimeout(r, 100));

                const result = await lock.renew('test-lock', 5000);
                expect(result).toBe(false);
            });
        });

        it('should extend TTL on renew', async () => {
            await runInScope(async () => {
                const lock = new GGLocatorScopeLock();
                await lock.acquire('test-lock', 100);

                // Wait a bit
                await new Promise(r => setTimeout(r, 50));

                // Renew with more time
                await lock.renew('test-lock', 200);

                // Wait past original expiry
                await new Promise(r => setTimeout(r, 100));

                // Should still be able to renew (lock still held)
                const result = await lock.renew('test-lock', 5000);
                expect(result).toBe(true);
            });
        });
    });

    describe('release', () => {
        it('should release held lock', async () => {
            await runInScope(async () => {
                const lock = new GGLocatorScopeLock();
                await lock.acquire('test-lock', 5000);
                await lock.release('test-lock');

                // Should be able to acquire again
                const result = await lock.acquire('test-lock', 5000);
                expect(result).toBe(true);
            });
        });

        it('should be idempotent - releasing non-existent lock is ok', async () => {
            await runInScope(async () => {
                const lock = new GGLocatorScopeLock();
                // Should not throw
                await lock.release('non-existent');
            });
        });

        it('should be idempotent - double release is ok', async () => {
            await runInScope(async () => {
                const lock = new GGLocatorScopeLock();
                await lock.acquire('test-lock', 5000);
                await lock.release('test-lock');

                // Should not throw
                await lock.release('test-lock');
            });
        });
    });

    describe('context isolation', () => {
        it('should isolate locks between different scopes', async () => {
            const lock = new GGLocatorScopeLock();

            // Acquire in first scope
            await runInScope(async () => {
                const result = await lock.acquire('test-lock', 5000);
                expect(result).toBe(true);
            });

            // Should also acquire in second scope (isolated)
            await runInScope(async () => {
                const result = await lock.acquire('test-lock', 5000);
                expect(result).toBe(true);
            });
        });

        it('should not see locks from other scopes', async () => {
            const lock = new GGLocatorScopeLock();

            // Acquire in first scope and hold a reference to check later
            let canRenewFromFirstScope = false;

            const scope1 = new GGLocatorScope('test');
            await scope1.run(async () => {
                await lock.acquire('test-lock', 5000);
                canRenewFromFirstScope = await lock.renew('test-lock', 5000);
            });

            expect(canRenewFromFirstScope).toBe(true);

            // In second scope, the lock doesn't exist
            await runInScope(async () => {
                const result = await lock.renew('test-lock', 5000);
                expect(result).toBe(false);
            });
        });

        it('should allow concurrent locks in different scopes', async () => {
            const lock = new GGLocatorScopeLock();

            const results = await Promise.all([
                runInScope(async () => lock.acquire('test-lock', 5000)),
                runInScope(async () => lock.acquire('test-lock', 5000)),
                runInScope(async () => lock.acquire('test-lock', 5000)),
            ]);

            // All should succeed because they're in different scopes
            expect(results).toEqual([true, true, true]);
        });
    });

    describe('nested scopes', () => {
        it('should isolate lock storage in nested scopes', async () => {
            const lock = new GGLocatorScopeLock();

            await runInScope(async () => {
                await lock.acquire('test-lock', 5000);

                // Nested runInScope creates a new isolated scope
                await runInScope(async () => {
                    const result = await lock.acquire('test-lock', 5000);
                    // Should succeed because nested scope is isolated
                    expect(result).toBe(true);
                });

                // Original scope still holds its lock
                const renewResult = await lock.renew('test-lock', 5000);
                expect(renewResult).toBe(true);
            });
        });
    });
});
