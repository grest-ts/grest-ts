import {describe, it, expect} from 'vitest';
import {IsNumber, IsObject, IsPosInt, IsString} from "@grest-ts/schema";
import {GGConfig} from '../GGConfig';
import {GGSetting} from '../keys/GGSetting';
import {GGResource} from '../keys/GGResource';
import {GGConfigKey} from "../GGConfigKey";
import {createLocalConfig, GGConfigStoreLocal} from './GGConfigStoreLocal';

const Config = GGConfig.define("/local_app/", () => ({
    port: new GGSetting("port", IsPosInt, 4000, "HTTP port"),
    domain: new GGResource("domain", IsString, "Public domain"),
    region: new GGResource("region", IsString.orUndefined, "Region, when not the SDK default"),
    jobs: {
        sweep: new GGSetting("jobs/sweep", IsObject({everyMs: IsNumber}), {everyMs: 60_000}, "Sweep job"),
    },
    db: {
        host: new GGResource("db/host", IsString, "DB host"),
        poolSize: new GGSetting("db/pool_size", IsPosInt, 10, "DB pool size"),
    },
}));

async function started(values: Parameters<typeof createLocalConfig<typeof Config>>[1]): Promise<GGConfigStoreLocal<typeof Config>> {
    const store = new GGConfigStoreLocal(Config, createLocalConfig(Config, values));
    store.setKeys([Config.port, Config.domain, Config.region, Config.jobs.sweep, Config.db.host, Config.db.poolSize] as GGConfigKey[]);
    await store.start();
    return store;
}

describe('GGConfigStoreLocal', () => {
    it('lets settings and keys that accept undefined be left out', async () => {
        const store = await started({domain: "example.com", db: {host: "localhost"}});
        expect([store.getValue(Config.port), store.getValue(Config.jobs.sweep), store.getValue(Config.db.poolSize), store.getValue(Config.region)])
            .toEqual([4000, {everyMs: 60_000}, 10, undefined]);
    });

    it('uses a given setting value over the default', async () => {
        const store = await started({domain: "example.com", db: {host: "localhost", poolSize: 2}, jobs: {sweep: {everyMs: 5}}});
        expect([store.getValue(Config.db.poolSize), store.getValue(Config.jobs.sweep)]).toEqual([2, {everyMs: 5}]);
    });

    it('still requires resources', () => {
        // @ts-expect-error domain is required
        createLocalConfig(Config, {db: {host: "localhost"}});
        // @ts-expect-error db.host is required
        createLocalConfig(Config, {domain: "example.com", db: {}});
    });
});
