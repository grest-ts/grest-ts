import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {GGLocatorScope} from '@grest-ts/locator';
import {GGLog} from '@grest-ts/logger';
import {GGInstanceLock} from './instance/GGInstanceLock';
import {GGLock} from './GGLock';
import {withLock} from './withLock';

const scope = new GGLocatorScope('withLock-test');
scope.run(() => GGLog.init());

const inScope = <T>(fn: () => Promise<T>): Promise<T> => scope.run(fn);
const untilAborted = (signal: AbortSignal) => new Promise<void>(r => signal.addEventListener('abort', () => r()));

describe('withLock', () => {
    beforeEach(() => { vi.useFakeTimers({now: 1_000_000}); });
    afterEach(() => { vi.useRealTimers(); });

    it('runs fn and releases the lock', async () => {
        const lock = new GGInstanceLock();
        const fn = vi.fn(async () => {});

        expect(await inScope(() => withLock(lock, 'job', {owner: 'a', ttlMs: 3000}, fn))).toBe('DONE');
        expect(fn).toHaveBeenCalledOnce();
        expect(await lock.acquire('job', 'b', 3000)).toBe(true);
    });

    it('returns BUSY without running fn when someone holds the lock', async () => {
        const lock = new GGInstanceLock();
        await lock.acquire('job', 'other', 3000);
        const fn = vi.fn(async () => {});

        expect(await inScope(() => withLock(lock, 'job', {owner: 'a', ttlMs: 3000}, fn))).toBe('BUSY');
        expect(fn).not.toHaveBeenCalled();
    });

    it('keeps the lock until holdUntil after fn completes', async () => {
        const lock = new GGInstanceLock();

        await inScope(() => withLock(lock, 'job', {owner: 'a', ttlMs: 3000, holdUntil: Date.now() + 10_000}, async () => {}));

        expect(await lock.acquire('job', 'b', 3000)).toBe(false);
        vi.advanceTimersByTime(10_000);
        expect(await lock.acquire('job', 'b', 3000)).toBe(true);
    });

    it('releases without holdUntil when fn throws or is aborted', async () => {
        const lock = new GGInstanceLock();
        const holdUntil = Date.now() + 10_000;

        await expect(inScope(() => withLock(lock, 'job', {owner: 'a', ttlMs: 3000, holdUntil}, async () => { throw new Error('boom'); }))).rejects.toThrow('boom');
        expect(await lock.acquire('job', 'b', 3000)).toBe(true);
        await lock.release('job', 'b');

        const stop = new AbortController();
        const run = inScope(() => withLock(lock, 'job', {owner: 'a', ttlMs: 3000, holdUntil, signal: stop.signal}, untilAborted));
        await vi.advanceTimersByTimeAsync(100);
        stop.abort();
        expect(await run).toBe('DONE');
        expect(await lock.acquire('job', 'b', 3000)).toBe(true);
    });

    it('aborts fn and does not release when a renew finds the lock lost', async () => {
        const release = vi.fn(async () => {});
        const lock: GGLock = {acquire: async () => true, renew: async () => false, release};

        const run = inScope(() => withLock(lock, 'job', {owner: 'a', ttlMs: 3000}, untilAborted));
        await vi.advanceTimersByTimeAsync(1_000);

        expect(await run).toBe('LOST');
        expect(release).not.toHaveBeenCalled();
    });

    it('counts the lock as lost once renews keep failing for two thirds of a TTL', async () => {
        const lock: GGLock = {acquire: async () => true, renew: async () => { throw new Error('unreachable'); }, release: async () => {}};

        const run = inScope(() => withLock(lock, 'job', {owner: 'a', ttlMs: 3000}, untilAborted));
        await vi.advanceTimersByTimeAsync(1_500);
        let result: string | undefined;
        void run.then(r => { result = r; });
        await vi.advanceTimersByTimeAsync(0);
        expect(result).toBeUndefined();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(await run).toBe('LOST');
    });
});
