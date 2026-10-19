import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {IsObject, IsPosInt, IsString} from "@grest-ts/schema";
import {GGLocatorScope} from "@grest-ts/locator";
import {sleep} from "@grest-ts/common";
import {GGConfig} from '../GGConfig';
import {GGConfigLocator} from '../GGConfigLocator';
import {GGConfigKey, GGConfigKeyConstructor} from '../GGConfigKey';
import {GGConfigStore} from '../GGConfigStore';
import {GGSetting} from '../keys/GGSetting';
import {GGConfigStoreFile} from './GGConfigStoreFile';

// The vitest setup loads testkit, which patches GGConfigLocator.add to wrap stores in GGConfigTestStore.
class PlainConfigLocator extends GGConfigLocator<any> {
    public override add<Key extends GGConfigKey>(key: GGConfigKeyConstructor<Key>, store: GGConfigStore<Key>): this {
        return this._add(key, store);
    }
}

const Config = GGConfig.define("/file_app/", () => ({
    port: new GGSetting("port", IsPosInt, 4000, "HTTP port"),
    name: new GGSetting("name", IsString, "app", "Service name"),
    db: new GGSetting("db", IsObject({host: IsString}), {host: "localhost"}, "DB"),
}));

const until = (check: () => void) => vi.waitFor(check, {timeout: 3000, interval: 20});
const serialize = (content: unknown) => typeof content === "string" ? content : JSON.stringify(content);

describe('GGConfigStoreFile', () => {
    let dir: string;
    let file: string;
    let scope: GGLocatorScope;
    let locator: PlainConfigLocator;
    let store: GGConfigStoreFile<GGSetting<any>>;
    let reloadErrors: Error[];
    const unhandled = vi.fn();

    const doc = (port: number, name = "app", host = "localhost") => ({file_app: {port, name, db: {host}}});
    const writeAtomic = (content: unknown) => {
        const tmp = join(dir, `.settings.${Math.random()}.tmp`);
        fs.writeFileSync(tmp, serialize(content));
        fs.renameSync(tmp, file);
    };
    const writeInPlace = (content: unknown) => fs.writeFileSync(file, serialize(content));
    const values = () => [store.getValue(Config.port), store.getValue(Config.name), store.getValue(Config.db)];

    beforeEach(async () => {
        dir = fs.mkdtempSync(join(tmpdir(), "gg-config-file-"));
        file = join(dir, "settings.json");
        writeInPlace(doc(1000));
        reloadErrors = [];
        unhandled.mockReset();
        process.on('unhandledRejection', unhandled);
        scope = new GGLocatorScope("config-file-test");
        scope.setLifecycleOwner(() => undefined);
        scope.enter();
        store = new GGConfigStoreFile(file);
        locator = new PlainConfigLocator(Config).add(GGSetting, store);
        locator.onReloadError = (error) => void reloadErrors.push(error);
        await locator.start();
    });

    afterEach(async () => {
        await locator.teardown();
        process.off('unhandledRejection', unhandled);
        fs.rmSync(dir, {recursive: true, force: true});
    });

    it('picks up rename-based writes, repeatedly', async () => {
        expect(values()).toEqual([1000, "app", {host: "localhost"}]);
        for (const port of [1001, 1002, 1003]) {
            writeAtomic(doc(port));
            await until(() => expect(store.getValue(Config.port)).toBe(port));
        }
        expect(reloadErrors).toEqual([]);
    });

    it('picks up in-place writes', async () => {
        writeInPlace(doc(2000, "renamed"));
        await until(() => expect(values()).toEqual([2000, "renamed", {host: "localhost"}]));
    });

    it.each([
        ["invalid JSON", "{not json", /JSON/],
        ["an empty file", "", /empty/],
        ["a schema failure", doc(-5, "other", "db.example"), /\/file_app\/port/],
    ])('keeps the last good values for all keys on %s, then applies the next valid write', async (_, content, error) => {
        writeAtomic(content);
        await until(() => expect(reloadErrors).toHaveLength(1));
        expect(reloadErrors[0].message).toMatch(error);
        expect(values()).toEqual([1000, "app", {host: "localhost"}]);

        writeAtomic(doc(3000, "fixed"));
        await until(() => expect(values()).toEqual([3000, "fixed", {host: "localhost"}]));
        expect(unhandled).not.toHaveBeenCalled();
    });

    it('reports a deleted file, keeps the last good values and reloads when it is written back', async () => {
        fs.unlinkSync(file);
        await until(() => expect(reloadErrors.map(e => (e as NodeJS.ErrnoException).code)).toEqual(["ENOENT"]));
        expect(values()).toEqual([1000, "app", {host: "localhost"}]);

        writeAtomic(doc(3500));
        await until(() => expect(store.getValue(Config.port)).toBe(3500));
    });

    it('notifies only changed keys, once per change, with the new value', async () => {
        const port = vi.fn(), name = vi.fn(), db = vi.fn();
        store.watch(Config.port, port);
        store.watch(Config.name, name);
        store.watch(Config.db, db);

        writeAtomic(doc(4000, "app", "db.example"));
        await until(() => expect(db).toHaveBeenCalledTimes(1));
        expect(port).toHaveBeenCalledExactlyOnceWith(4000);
        expect(db).toHaveBeenCalledExactlyOnceWith({host: "db.example"});
        expect(name).not.toHaveBeenCalled();

        writeAtomic(doc(4001, "app", "db.example"));
        await until(() => expect(port).toHaveBeenCalledTimes(2));
        expect(port).toHaveBeenLastCalledWith(4001);
        expect(db).toHaveBeenCalledTimes(1);
    });

    it('survives a throwing watcher', async () => {
        store.watch(Config.port, () => {
            throw new Error("watcher failed");
        });
        const name = vi.fn();
        store.watch(Config.name, name);

        writeAtomic(doc(5000, "changed"));
        await until(() => expect(reloadErrors.map(e => e.message)).toEqual(["watcher failed"]));
        expect(name).toHaveBeenCalledExactlyOnceWith("changed");

        writeAtomic(doc(5001, "changed"));
        await until(() => expect(store.getValue(Config.port)).toBe(5001));
        expect(unhandled).not.toHaveBeenCalled();
    });

    it('does not reload after teardown', async () => {
        writeAtomic(doc(6000));
        await locator.teardown();
        writeAtomic(doc(6001));
        await sleep(300);
        expect(store.getValue(Config.port)).toBe(1000);
    });
});
