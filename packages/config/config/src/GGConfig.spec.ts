import {describe, it, expect} from 'vitest';
import {IsObject, IsPosInt, IsString} from "@grest-ts/schema";
import {GGConfig} from './GGConfig';
import {GGSetting} from './keys/GGSetting';
import {GGSecret} from './keys/GGSecret';
import {GGResource} from './keys/GGResource';

const Config = GGConfig.define("/doc_app/", () => ({
    port: new GGSetting("port", IsPosInt, 4000, "HTTP port"),
    appUrl: new GGResource("app_url", IsString, "Public app URL"),
    token: new GGSecret("token", IsString, "Signing key"),
    optionalCreds: new GGSecret("db/creds", IsObject({user: IsString}).orUndefined, "Optional credentials"),
    db: new GGResource("db/host", IsObject({region: IsString}), "DB host"),
}));

describe('GGConfig.describe', () => {
    it('lists every key with type, required flag and default, sorted by name', () => {
        expect(GGConfig.describe(Config).map(k => [k.name, k.type, k.required, k.default])).toEqual([
            ["/doc_app/app_url", "[GGResource]", true, undefined],
            ["/doc_app/db/creds", "[GGSecret]", false, undefined],
            ["/doc_app/db/host", "[GGResource]", true, undefined],
            ["/doc_app/port", "[GGSetting]", false, 4000],
            ["/doc_app/token", "[GGSecret]", true, undefined],
        ]);
    });

    it('filters by key type', () => {
        expect(GGConfig.describe(Config, {types: [GGSecret]}).map(k => k.name)).toEqual(["/doc_app/db/creds", "/doc_app/token"]);
    });
});

describe('GGConfig.check', () => {
    it('accepts a complete document and reports defaulted keys', () => {
        const result = GGConfig.check(Config, {doc_app: {app_url: "https://app.example.com", token: "t", db: {host: {region: "eu-west-1"}}}});
        expect(result).toEqual({missing: [], invalid: [], defaulted: ["/doc_app/port"], unknown: [], ok: true});
    });

    it('reports missing required keys, treating null as missing', () => {
        const result = GGConfig.check(Config, {doc_app: {app_url: null, db: {host: {region: "eu-west-1"}}}});
        expect(result.missing).toEqual(["/doc_app/app_url", "/doc_app/token"]);
        expect(result.ok).toBe(false);
    });

    it('reports values failing their schema', () => {
        const result = GGConfig.check(Config, {doc_app: {app_url: 42, token: "t", db: {host: {region: "eu-west-1"}}}});
        expect(result.invalid.map(i => i.name)).toEqual(["/doc_app/app_url"]);
        expect(result.ok).toBe(false);
    });

    it('reports unknown paths at their highest unread node, never inside a key value', () => {
        const result = GGConfig.check(Config, {
            doc_app: {app_url: "u", token: "t", db: {host: {region: "r", extra: 1}, legacy: "x"}, old_block: {a: {b: 1}}},
            other_root: true,
        });
        expect(result.unknown).toEqual(["/doc_app/db/legacy", "/doc_app/old_block", "/other_root"]);
        expect(result.ok).toBe(true);
    });
});

describe('GGConfig.template', () => {
    it('emits required keys as null', () => {
        expect(GGConfig.template(Config)).toEqual({doc_app: {app_url: null, token: null, db: {host: null}}});
    });

    it('includes defaults when asked', () => {
        expect(GGConfig.template(Config, {includeDefaults: true})).toEqual({doc_app: {app_url: null, token: null, port: 4000, db: {host: null}}});
    });

    it('round-trips: check(template) reports exactly the required keys as missing', () => {
        const result = GGConfig.check(Config, GGConfig.template(Config));
        expect(result.missing).toEqual(["/doc_app/app_url", "/doc_app/db/host", "/doc_app/token"]);
        expect(result.unknown).toEqual([]);
    });
});
