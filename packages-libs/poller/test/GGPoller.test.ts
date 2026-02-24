import {expect} from 'vitest';
import {GGPoller} from '../src/GGPoller';
import {GGPollerConfig, GGPollerConfigData} from '../src/GGPollerConfig';
import {GGInstanceLock} from '@grest-ts/lock';
import {GGTestPollerStore} from '../testkit/GGTestPollerStore';
import {GG_CONFIG, GGConfig, GGConfigKey} from '@grest-ts/config';
import {GGLocator} from '@grest-ts/locator';

function ensureConfigLoader() {
    if (!GG_CONFIG.has()) {
        const values = new Map<GGConfigKey, unknown>();
        values.set(defaultConfig.settings, defaultSettings);
        values.set(invalidHeartbeatConfig.settings, invalidHeartbeatSettings);
        values.set(invalidConcurrencyConfig.settings, invalidConcurrencySettings);
        values.set(fastRetryConfig.settings, fastRetrySettings);
        values.set(highConcurrencyConfig.settings, highConcurrencySettings);
        values.set(fastHeartbeatConfig.settings, fastHeartbeatSettings);
        const store = {
            started: true,
            getValue: <T>(key: GGConfigKey<T>) => values.get(key) as T,
            watch: () => () => {},
        };
        GGLocator.getScope().set(GG_CONFIG, {getStore: () => store} as any);
    }
}

interface TestItemData {
    id: string;
    message: string;
}

// Settings for each config — previously passed as constructor defaults
const defaultSettings: GGPollerConfigData = {
    lockTtlMs: 5000,
    heartbeatIntervalMs: 1000,
    pollIntervalMs: 100,
    batchSize: 10,
    concurrency: 2,
    retryAcquireIntervalMs: 500,
    instanceId: 'test-instance',
};

const invalidHeartbeatSettings: GGPollerConfigData = {
    lockTtlMs: 5000,
    heartbeatIntervalMs: 5000, // Invalid: equal to lockTtlMs
    pollIntervalMs: 100,
    batchSize: 10,
    concurrency: 2,
    retryAcquireIntervalMs: 500,
};

const invalidConcurrencySettings: GGPollerConfigData = {
    lockTtlMs: 5000,
    heartbeatIntervalMs: 1000,
    pollIntervalMs: 100,
    batchSize: 10,
    concurrency: 0, // Invalid: must be at least 1
    retryAcquireIntervalMs: 500,
};

const fastRetrySettings: GGPollerConfigData = {
    lockTtlMs: 5000,
    heartbeatIntervalMs: 1000,
    pollIntervalMs: 100,
    batchSize: 10,
    concurrency: 2,
    retryAcquireIntervalMs: 50,
};

const highConcurrencySettings: GGPollerConfigData = {
    lockTtlMs: 5000,
    heartbeatIntervalMs: 1000,
    pollIntervalMs: 50,
    batchSize: 20,
    concurrency: 3,
    retryAcquireIntervalMs: 500,
};

const fastHeartbeatSettings: GGPollerConfigData = {
    lockTtlMs: 200,
    heartbeatIntervalMs: 50,
    pollIntervalMs: 100,
    batchSize: 10,
    concurrency: 2,
    retryAcquireIntervalMs: 500,
};

// Config instances created once and reused (GGConfigKey registry rejects duplicates)
const defaultConfig = GGConfig.define("/test/", () => new GGPollerConfig('test_poller_default'));

const invalidHeartbeatConfig = GGConfig.define("/test/", () => new GGPollerConfig('test_poller_invalid_hb'));

const invalidConcurrencyConfig = GGConfig.define("/test/", () => new GGPollerConfig('test_poller_invalid_conc'));

const fastRetryConfig = GGConfig.define("/test/", () => new GGPollerConfig('test_poller_fast_retry'));

const highConcurrencyConfig = GGConfig.define("/test/", () => new GGPollerConfig('test_poller_high_conc'));

const fastHeartbeatConfig = GGConfig.define("/test/", () => new GGPollerConfig('test_poller_fast_hb'));

describe('GGPoller', () => {
    // Must be called BEFORE nested describes, so child scopes inherit the config
    ensureConfigLoader();

    let lock: GGInstanceLock;
    let store: GGTestPollerStore<TestItemData>;
    let poller: GGPoller<TestItemData> | null;

    beforeEach(() => {
        lock = new GGInstanceLock();
        store = new GGTestPollerStore<TestItemData>();
        poller = null;
    });

    afterEach(async () => {
        if (poller && poller.getState() !== 'stopped') {
            await poller.stop();
        }
    });

    describe('constructor', () => {
        it('should validate heartbeatIntervalMs < lockTtlMs', () => {
            expect(() => new GGPoller(
                invalidHeartbeatConfig,
                lock,
                store.createHandler(async () => {
                })
            )).toThrow('heartbeatIntervalMs');
        });

        it('should validate concurrency >= 1', () => {
            expect(() => new GGPoller(
                invalidConcurrencyConfig,
                lock,
                store.createHandler(async () => {
                })
            )).toThrow('concurrency');
        });
    });

    describe('start/stop', () => {
        it('should start in waiting state and acquire lock to become leader', async () => {
            const config = defaultConfig;
            poller = new GGPoller(
                config,
                lock,
                store.createHandler(async () => {
                })
            );

            expect(poller.getState()).toBe('stopped');

            await poller.start();

            // Should acquire lock and become leader quickly
            await new Promise(r => setTimeout(r, 50));

            expect(poller.getState()).toBe('leader');
            expect(poller.isLeader()).toBe(true);
        });

        it('should stop gracefully and release lock', async () => {
            const config = defaultConfig;
            poller = new GGPoller(
                config,
                lock,
                store.createHandler(async () => {
                })
            );

            await poller.start();
            await new Promise(r => setTimeout(r, 50));

            expect(poller.isLeader()).toBe(true);

            await poller.stop();

            expect(poller.getState()).toBe('stopped');
            expect(poller.isLeader()).toBe(false);

            // Lock should be released - another acquire should succeed
            const canAcquire = await lock.acquire(config.lockName, 1000);
            expect(canAcquire).toBe(true);
        });

        it('should not allow starting twice', async () => {
            poller = new GGPoller(
                defaultConfig,
                lock,
                store.createHandler(async () => {
                })
            );

            await poller.start();

            await expect(poller.start()).rejects.toThrow('Cannot start');
        });
    });

    describe('leader election', () => {
        it('should wait if lock is held', async () => {
            const config = defaultConfig;
            // Acquire lock before poller starts (simulates another holder)
            await lock.acquire(config.lockName, 10000);

            poller = new GGPoller(
                config,
                lock,
                store.createHandler(async () => {
                })
            );

            await poller.start();
            await new Promise(r => setTimeout(r, 50));

            expect(poller.getState()).toBe('waiting');
            expect(poller.isLeader()).toBe(false);
        });

        it('should become leader when lock becomes available', async () => {
            const config = fastRetryConfig;
            // Acquire lock with short TTL
            await lock.acquire(config.lockName, 100);

            poller = new GGPoller(
                config,
                lock,
                store.createHandler(async () => {
                })
            );

            await poller.start();
            await new Promise(r => setTimeout(r, 30));

            expect(poller.getState()).toBe('waiting');

            // Wait for lock to expire and poller to acquire it
            await new Promise(r => setTimeout(r, 200));

            expect(poller.getState()).toBe('leader');
        });
    });

    describe('item processing', () => {
        it('should process pending items', async () => {
            const processed: string[] = [];

            store.addItems([
                {id: '1', message: 'hello'},
                {id: '2', message: 'world'}
            ]);

            poller = new GGPoller(
                defaultConfig,
                lock,
                store.createHandler(async (data) => {
                    processed.push(data.id);
                })
            );

            await poller.start();

            // Wait for items to be processed
            await store.waitForAllComplete(2000);

            expect(processed).toContain('1');
            expect(processed).toContain('2');
            expect(store.getCompletedCount()).toBe(2);
        });

        it('should respect concurrency limit', async () => {
            let concurrentCount = 0;
            let maxConcurrent = 0;

            // Add many items
            for (let i = 0; i < 10; i++) {
                store.addItem({id: String(i), message: `item-${i}`});
            }

            poller = new GGPoller(
                highConcurrencyConfig,
                lock,
                store.createHandler(async () => {
                    concurrentCount++;
                    maxConcurrent = Math.max(maxConcurrent, concurrentCount);
                    await new Promise(r => setTimeout(r, 100));
                    concurrentCount--;
                })
            );

            await poller.start();
            await store.waitForAllComplete(5000);

            expect(maxConcurrent).toBeLessThanOrEqual(3);
            expect(store.getCompletedCount()).toBe(10);
        });

        it('should handle item failures', async () => {
            store.addItem({id: 'fail-item', message: 'will fail'});

            poller = new GGPoller(
                defaultConfig,
                lock,
                store.createHandler(async () => {
                    throw new Error('Item failed!');
                }, {maxAttempts: 1})
            );

            await poller.start();

            // Wait for item to fail
            await new Promise(r => setTimeout(r, 500));

            const failedRuns = store.runCalls.filter(r => !r.success);
            expect(failedRuns.length).toBeGreaterThan(0);
            expect(store.getFailedCount()).toBe(1);
        });

        it('should call onCompleted with batch report', async () => {
            store.addItems([
                {id: '1', message: 'a'},
                {id: '2', message: 'b'}
            ]);

            poller = new GGPoller(
                defaultConfig,
                lock,
                store.createHandler(async () => {
                    await new Promise(r => setTimeout(r, 10));
                })
            );

            await poller.start();
            await store.waitForAllComplete(2000);

            // Should have received batch reports
            expect(store.completedReports.length).toBeGreaterThan(0);

            // Find a non-empty batch report
            const nonEmptyReport = store.completedReports.find(r => !r.report.empty);
            expect(nonEmptyReport).toBeDefined();
            expect(nonEmptyReport!.report.processed).toBeGreaterThan(0);
        });
    });

    describe('crash resilience', () => {
        it('should detect lock expiry and go back to waiting', async () => {
            const config = fastHeartbeatConfig;
            poller = new GGPoller(
                config,
                lock,
                store.createHandler(async () => {
                })
            );

            await poller.start();
            await new Promise(r => setTimeout(r, 100));

            expect(poller.isLeader()).toBe(true);

            // Release the lock (simulates lock expiry or takeover)
            await lock.release(config.lockName);

            // Wait for heartbeat to detect loss (renew will fail)
            await new Promise(r => setTimeout(r, 200));

            expect(poller.getState()).toBe('waiting');
            expect(poller.isLeader()).toBe(false);
        });
    });
});

describe('GGTestPollerStore', () => {
    it('should track item lifecycle', async () => {
        const store = new GGTestPollerStore<TestItemData>();

        store.addItem({id: '1', message: 'test'});

        expect(store.getPendingCount()).toBe(1);

        const handler = store.createHandler(async () => {
        });

        const items = await handler.getData(10);
        expect(items.length).toBe(1);
        expect(store.getItemsByStatus('processing').length).toBe(1);

        await handler.run(items[0]);

        expect(store.getCompletedCount()).toBe(1);
    });
});
