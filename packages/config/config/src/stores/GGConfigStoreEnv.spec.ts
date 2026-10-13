import {describe, it, expect} from 'vitest';
import {IsBoolean, IsObject, IsPosInt, IsString} from "@grest-ts/schema";
import {GGConfig} from '../GGConfig';
import {GGSetting} from '../keys/GGSetting';
import {GGResource} from '../keys/GGResource';
import {GGConfigStoreEnv} from './GGConfigStoreEnv';
import {GGConfigKey} from "../GGConfigKey";

const Config = GGConfig.define("/env_app/", () => ({
    port: new GGSetting("port", IsPosInt, 4000, "HTTP port"),
    verbose: new GGSetting("verbose", IsBoolean, false, "Verbose logging"),
    domain: new GGResource("hosting/domain", IsString, "Public domain"),
    numericId: new GGResource("numeric_id", IsString, "An id that happens to be digits"),
    db: new GGResource("db", IsObject({region: IsString}), "DB host"),
}));
const keys: GGConfigKey[] = [Config.port, Config.verbose, Config.domain, Config.numericId, Config.db];

async function started(env: NodeJS.ProcessEnv): Promise<GGConfigStoreEnv> {
    const store = new GGConfigStoreEnv({prefix: "APP_", env});
    store.setKeys(keys);
    await store.start();
    return store;
}

const required = {APP_HOSTING_DOMAIN: "example.com", APP_NUMERIC_ID: "0042", APP_DB: '{"region":"eu-west-1"}'};

describe('GGConfigStoreEnv', () => {
    it('maps key names to prefixed upper-case variables, dropping the config root', () => {
        expect(new GGConfigStoreEnv({prefix: "APP_"}).variableName(Config.domain)).toBe("APP_HOSTING_DOMAIN");
    });

    it('reads strings verbatim and JSON-parses values the schema rejects as strings', async () => {
        const store = await started({...required, APP_PORT: "8080", APP_VERBOSE: "true"});
        expect(keys.map(k => store.getValue(k))).toEqual([8080, true, "example.com", "0042", {region: "eu-west-1"}]);
    });

    it('falls back to defaults for unset and empty variables', async () => {
        const store = await started({...required, APP_PORT: ""});
        expect([store.getValue(Config.port), store.getValue(Config.verbose)]).toEqual([4000, false]);
    });

    it('fails start when a required variable is missing or invalid', async () => {
        await expect(started({...required, APP_HOSTING_DOMAIN: undefined})).rejects.toThrow(/\/env_app\/hosting\/domain/);
        await expect(started({...required, APP_PORT: "-1"})).rejects.toThrow(/\/env_app\/port/);
    });
});
