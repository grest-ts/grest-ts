import {describe, it, expect, beforeEach} from 'vitest';
import {GGInstanceLock} from './GGInstanceLock';

describe('GGInstanceLock', () => {
    let lock: GGInstanceLock;

    beforeEach(() => {
        lock = new GGInstanceLock();
    });

    describe('acquire', () => {
        it('should acquire lock when not held', async () => {
            const result = await lock.acquire('test-lock', 'a', 5000);
            expect(result).toBe(true);
        });

        it('should fail to acquire when already held', async () => {
            await lock.acquire('test-lock', 'a', 5000);
            const result = await lock.acquire('test-lock', 'a', 5000);
            expect(result).toBe(false);
        });

        it('should allow acquiring different locks', async () => {
            const result1 = await lock.acquire('lock-1', 'a', 5000);
            const result2 = await lock.acquire('lock-2', 'a', 5000);
            expect(result1).toBe(true);
            expect(result2).toBe(true);
        });

        it('should acquire expired lock', async () => {
            await lock.acquire('test-lock', 'a', 50);

            // Wait for expiry
            await new Promise(r => setTimeout(r, 100));

            const result = await lock.acquire('test-lock', 'a', 5000);
            expect(result).toBe(true);
        });

        it('should not acquire non-expired lock', async () => {
            await lock.acquire('test-lock', 'a', 5000);

            // Short wait, lock should still be valid
            await new Promise(r => setTimeout(r, 10));

            const result = await lock.acquire('test-lock', 'a', 5000);
            expect(result).toBe(false);
        });
    });

    describe('renew', () => {
        it('should renew held lock', async () => {
            await lock.acquire('test-lock', 'a', 5000);
            const result = await lock.renew('test-lock', 'a', 5000);
            expect(result).toBe(true);
        });

        it('should fail to renew non-existent lock', async () => {
            const result = await lock.renew('non-existent', 'a', 5000);
            expect(result).toBe(false);
        });

        it('should fail to renew expired lock', async () => {
            await lock.acquire('test-lock', 'a', 50);

            // Wait for expiry
            await new Promise(r => setTimeout(r, 100));

            const result = await lock.renew('test-lock', 'a', 5000);
            expect(result).toBe(false);
        });

        it('should extend TTL on renew', async () => {
            await lock.acquire('test-lock', 'a', 100);

            // Wait a bit
            await new Promise(r => setTimeout(r, 50));

            // Renew with more time
            await lock.renew('test-lock', 'a', 200);

            // Wait past original expiry
            await new Promise(r => setTimeout(r, 100));

            // Should still be able to renew (lock still held)
            const result = await lock.renew('test-lock', 'a', 5000);
            expect(result).toBe(true);
        });
    });

    describe('release', () => {
        it('should release held lock', async () => {
            await lock.acquire('test-lock', 'a', 5000);
            await lock.release('test-lock', 'a');

            // Should be able to acquire again
            const result = await lock.acquire('test-lock', 'a', 5000);
            expect(result).toBe(true);
        });

        it('should be idempotent - releasing non-existent lock is ok', async () => {
            // Should not throw
            await lock.release('non-existent', 'a');
        });

        it('should be idempotent - double release is ok', async () => {
            await lock.acquire('test-lock', 'a', 5000);
            await lock.release('test-lock', 'a');

            // Should not throw
            await lock.release('test-lock', 'a');
        });
    });

    describe('isolation', () => {
        it('should isolate different lock instances', async () => {
            const lock2 = new GGInstanceLock();

            await lock.acquire('test-lock', 'a', 5000);

            // Different instance should be able to acquire same lock name
            const result = await lock2.acquire('test-lock', 'a', 5000);
            expect(result).toBe(true);
        });
    });

    describe('concurrent operations', () => {
        it('should handle concurrent acquire attempts', async () => {
            // Simulate concurrent attempts
            const results = await Promise.all([
                lock.acquire('test-lock', 'a', 5000),
                lock.acquire('test-lock', 'a', 5000),
                lock.acquire('test-lock', 'a', 5000),
            ]);

            // Exactly one should succeed
            const successes = results.filter(r => r === true);
            expect(successes.length).toBe(1);
        });
    });

    describe('owner', () => {
        it('should not let another owner renew or release a held lock', async () => {
            await lock.acquire('test-lock', 'a', 5000);
            expect(await lock.renew('test-lock', 'b', 5000)).toBe(false);
            await lock.release('test-lock', 'b');
            expect(await lock.acquire('test-lock', 'b', 5000)).toBe(false);
        });

        it('should not let an expired holder release the lock the next owner took', async () => {
            await lock.acquire('test-lock', 'a', 50);
            await new Promise(r => setTimeout(r, 100));
            expect(await lock.acquire('test-lock', 'b', 5000)).toBe(true);

            expect(await lock.renew('test-lock', 'a', 5000)).toBe(false);
            await lock.release('test-lock', 'a');
            expect(await lock.acquire('test-lock', 'c', 5000)).toBe(false);
        });
    });

    describe('release until', () => {
        it('should keep the lock taken, by no owner, until the given time', async () => {
            await lock.acquire('test-lock', 'a', 5000);
            await lock.release('test-lock', 'a', {until: Date.now() + 50});

            expect(await lock.acquire('test-lock', 'b', 5000)).toBe(false);
            expect(await lock.renew('test-lock', 'a', 5000)).toBe(false);

            await new Promise(r => setTimeout(r, 100));
            expect(await lock.acquire('test-lock', 'b', 5000)).toBe(true);
        });

        it('should free the lock straight away when until is in the past', async () => {
            await lock.acquire('test-lock', 'a', 5000);
            await lock.release('test-lock', 'a', {until: Date.now() - 1});
            expect(await lock.acquire('test-lock', 'b', 5000)).toBe(true);
        });
    });
});
