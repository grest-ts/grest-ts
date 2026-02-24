import {describe, it, expect, beforeEach} from 'vitest';
import {GGInstanceLock} from './GGInstanceLock';

describe('GGInstanceLock', () => {
    let lock: GGInstanceLock;

    beforeEach(() => {
        lock = new GGInstanceLock();
    });

    describe('acquire', () => {
        it('should acquire lock when not held', async () => {
            const result = await lock.acquire('test-lock', 5000);
            expect(result).toBe(true);
        });

        it('should fail to acquire when already held', async () => {
            await lock.acquire('test-lock', 5000);
            const result = await lock.acquire('test-lock', 5000);
            expect(result).toBe(false);
        });

        it('should allow acquiring different locks', async () => {
            const result1 = await lock.acquire('lock-1', 5000);
            const result2 = await lock.acquire('lock-2', 5000);
            expect(result1).toBe(true);
            expect(result2).toBe(true);
        });

        it('should acquire expired lock', async () => {
            await lock.acquire('test-lock', 50);

            // Wait for expiry
            await new Promise(r => setTimeout(r, 100));

            const result = await lock.acquire('test-lock', 5000);
            expect(result).toBe(true);
        });

        it('should not acquire non-expired lock', async () => {
            await lock.acquire('test-lock', 5000);

            // Short wait, lock should still be valid
            await new Promise(r => setTimeout(r, 10));

            const result = await lock.acquire('test-lock', 5000);
            expect(result).toBe(false);
        });
    });

    describe('renew', () => {
        it('should renew held lock', async () => {
            await lock.acquire('test-lock', 5000);
            const result = await lock.renew('test-lock', 5000);
            expect(result).toBe(true);
        });

        it('should fail to renew non-existent lock', async () => {
            const result = await lock.renew('non-existent', 5000);
            expect(result).toBe(false);
        });

        it('should fail to renew expired lock', async () => {
            await lock.acquire('test-lock', 50);

            // Wait for expiry
            await new Promise(r => setTimeout(r, 100));

            const result = await lock.renew('test-lock', 5000);
            expect(result).toBe(false);
        });

        it('should extend TTL on renew', async () => {
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

    describe('release', () => {
        it('should release held lock', async () => {
            await lock.acquire('test-lock', 5000);
            await lock.release('test-lock');

            // Should be able to acquire again
            const result = await lock.acquire('test-lock', 5000);
            expect(result).toBe(true);
        });

        it('should be idempotent - releasing non-existent lock is ok', async () => {
            // Should not throw
            await lock.release('non-existent');
        });

        it('should be idempotent - double release is ok', async () => {
            await lock.acquire('test-lock', 5000);
            await lock.release('test-lock');

            // Should not throw
            await lock.release('test-lock');
        });
    });

    describe('isolation', () => {
        it('should isolate different lock instances', async () => {
            const lock2 = new GGInstanceLock();

            await lock.acquire('test-lock', 5000);

            // Different instance should be able to acquire same lock name
            const result = await lock2.acquire('test-lock', 5000);
            expect(result).toBe(true);
        });
    });

    describe('concurrent operations', () => {
        it('should handle concurrent acquire attempts', async () => {
            // Simulate concurrent attempts
            const results = await Promise.all([
                lock.acquire('test-lock', 5000),
                lock.acquire('test-lock', 5000),
                lock.acquire('test-lock', 5000),
            ]);

            // Exactly one should succeed
            const successes = results.filter(r => r === true);
            expect(successes.length).toBe(1);
        });
    });
});
