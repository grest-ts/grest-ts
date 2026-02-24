import {describe, it, expect} from 'vitest';
import {assureValidConfigPath} from './assureValidConfigPath';

describe('assureValidConfigPath', () => {

    describe('valid paths', () => {
        it('accepts simple path', () => {
            expect(() => assureValidConfigPath('/app/setting')).not.toThrow();
        });

        it('accepts path with multiple segments', () => {
            expect(() => assureValidConfigPath('/app/db/host')).not.toThrow();
        });

        it('accepts path with underscores', () => {
            expect(() => assureValidConfigPath('/my_app/my_setting')).not.toThrow();
        });

        it('accepts path with numbers after letter', () => {
            expect(() => assureValidConfigPath('/app1/setting2')).not.toThrow();
        });

        it('accepts mixed valid characters', () => {
            expect(() => assureValidConfigPath('/my_app_v2/db_connection_pool_size')).not.toThrow();
        });

        it('accepts uppercase letters', () => {
            expect(() => assureValidConfigPath('/MyApp/DbHost')).not.toThrow();
        });

        it('accepts single segment', () => {
            expect(() => assureValidConfigPath('/setting')).not.toThrow();
        });
    });

    describe('must start with slash', () => {
        it('rejects path without leading slash', () => {
            expect(() => assureValidConfigPath('app/setting')).toThrow("must start with '/'");
        });

        it('rejects single word without slash', () => {
            expect(() => assureValidConfigPath('setting')).toThrow("must start with '/'");
        });
    });

    describe('cannot end with slash', () => {
        it('rejects path with trailing slash', () => {
            expect(() => assureValidConfigPath('/app/setting/')).toThrow("cannot end with '/'");
        });

        it('rejects root path (just slash)', () => {
            expect(() => assureValidConfigPath('/')).toThrow("cannot end with '/'");
        });
    });

    describe('no double slashes', () => {
        it('rejects double slash in middle', () => {
            expect(() => assureValidConfigPath('/app//setting')).toThrow("cannot contain '//'");
        });

        it('rejects double slash at start', () => {
            expect(() => assureValidConfigPath('//app/setting')).toThrow("cannot contain '//'");
        });

        it('rejects multiple double slashes', () => {
            expect(() => assureValidConfigPath('/app//db//host')).toThrow("cannot contain '//'");
        });
    });

    describe('invalid characters', () => {
        it('rejects dots', () => {
            expect(() => assureValidConfigPath('/app/db.host')).toThrow('invalid characters');
        });

        it('rejects hyphens', () => {
            expect(() => assureValidConfigPath('/my-app/setting')).toThrow('invalid characters');
        });

        it('rejects spaces', () => {
            expect(() => assureValidConfigPath('/app/my setting')).toThrow('invalid characters');
        });

        it('rejects special characters @', () => {
            expect(() => assureValidConfigPath('/app@host/setting')).toThrow('invalid characters');
        });

        it('rejects special characters #', () => {
            expect(() => assureValidConfigPath('/app#1/setting')).toThrow('invalid characters');
        });

        it('rejects special characters $', () => {
            expect(() => assureValidConfigPath('/app/$setting')).toThrow('invalid characters');
        });

        it('rejects special characters %', () => {
            expect(() => assureValidConfigPath('/app/100%')).toThrow('invalid characters');
        });

        it('rejects colon', () => {
            expect(() => assureValidConfigPath('/app:setting')).toThrow('invalid characters');
        });

        it('rejects backslash', () => {
            expect(() => assureValidConfigPath('/app\\setting')).toThrow('invalid characters');
        });
    });

    describe('segments must start with letter', () => {
        it('rejects segment starting with number', () => {
            expect(() => assureValidConfigPath('/app/1setting')).toThrow('must start with a letter');
        });

        it('rejects segment starting with underscore', () => {
            expect(() => assureValidConfigPath('/app/_setting')).toThrow('must start with a letter');
        });

        it('rejects first segment starting with number', () => {
            expect(() => assureValidConfigPath('/1app/setting')).toThrow('must start with a letter');
        });

        it('accepts segment with numbers after first letter', () => {
            expect(() => assureValidConfigPath('/app/s1e2t3')).not.toThrow();
        });
    });

    describe('max length', () => {
        it('accepts path at exactly 2048 characters', () => {
            const path = '/' + 'a'.repeat(2047);
            expect(path.length).toBe(2048);
            expect(() => assureValidConfigPath(path)).not.toThrow();
        });

        it('rejects path exceeding 2048 characters', () => {
            const path = '/' + 'a'.repeat(2048);
            expect(path.length).toBe(2049);
            expect(() => assureValidConfigPath(path)).toThrow('exceeds 2048 characters');
        });
    });

});
