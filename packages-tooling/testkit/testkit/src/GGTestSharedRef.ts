import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Reference counting for shared test resources across workers.
 *
 * Used to coordinate shared resources (e.g. database schemas)
 * that multiple workers use simultaneously. Handles file-system
 * based locking so callers don't need their own locking mechanism.
 *
 * - acquire(key, onCreate): first caller runs onCreate, others wait and skip
 * - release(key, onLast): last caller runs onLast (e.g. cleanup)
 */
export class GGTestSharedRef {

    private static getRefDir(): string {
        const runId = process.env.GG_TEST_RUN_ID;
        if (!runId) {
            throw new Error("GG_TEST_RUN_ID not set. Add globalSetup '@grest-ts/testkit-vitest/globalSetup' to vitest.config.ts.");
        }
        const dir = path.join(os.tmpdir(), `gg-test-${runId}`);
        fs.mkdirSync(dir, {recursive: true});
        return dir;
    }

    private static getRefFile(key: string): string {
        return path.join(this.getRefDir(), `${key}.ref`);
    }

    private static getLockPath(key: string): string {
        return path.join(this.getRefDir(), `${key}.lock`);
    }

    private static async acquireLock(key: string): Promise<void> {
        const lockPath = this.getLockPath(key);
        const timeout = 60000;
        const start = Date.now();
        while (true) {
            try {
                fs.mkdirSync(lockPath);
                return;
            } catch {
                if (Date.now() - start > timeout) {
                    throw new Error(`[GGTestSharedRef] Failed to acquire lock for '${key}' after ${timeout}ms`);
                }
                await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
            }
        }
    }

    private static releaseLock(key: string): void {
        try { fs.rmdirSync(this.getLockPath(key)); } catch {}
    }

    /**
     * Acquire a shared reference. If this is the first reference,
     * the onCreate callback is called (e.g. to create a shared resource).
     * Other callers wait for the lock and skip onCreate.
     */
    static async acquire(key: string, onCreate: () => Promise<void>): Promise<void> {
        await this.acquireLock(key);
        try {
            const file = this.getRefFile(key);
            let count = 0;
            try { count = parseInt(fs.readFileSync(file, 'utf-8')); } catch {}

            if (count === 0) {
                await onCreate();
            }

            fs.writeFileSync(file, (count + 1).toString());
        } finally {
            this.releaseLock(key);
        }
    }

    /**
     * Release a shared reference. If this is the last reference,
     * the onLast callback is called (e.g. to drop a shared resource).
     * Errors in onLast are caught and logged (cleanup is best-effort).
     */
    static async release(key: string, onLast: () => Promise<void>): Promise<void> {
        await this.acquireLock(key);
        try {
            const file = this.getRefFile(key);
            let count = 0;
            try { count = parseInt(fs.readFileSync(file, 'utf-8')); } catch {}
            count -= 1;

            if (count <= 0) {
                try { fs.unlinkSync(file); } catch {}
                try {
                    await onLast();
                } catch (err) {
                    console.error('[GGTestSharedRef] Cleanup failed:', err);
                }
            } else {
                fs.writeFileSync(file, count.toString());
            }
        } finally {
            this.releaseLock(key);
        }
    }

    /**
     * Remove the ref counting temp directory for the current test run.
     * Called by globalSetup teardown after all workers have finished.
     */
    static cleanup(): void {
        const runId = process.env.GG_TEST_RUN_ID;
        if (!runId) return;
        const dir = path.join(os.tmpdir(), `gg-test-${runId}`);
        try { fs.rmSync(dir, {recursive: true}); } catch {}
    }
}
