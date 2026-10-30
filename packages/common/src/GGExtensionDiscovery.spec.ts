import {afterEach, describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {GGExtensionDiscovery} from './GGExtensionDiscovery';

describe('GGExtensionDiscovery', () => {
    let dir: string;

    afterEach(() => fs.rmSync(dir, {recursive: true, force: true}));

    function install(name: string, withExtension: boolean): string {
        const pkgDir = path.join(dir, 'node_modules', name);
        fs.mkdirSync(path.join(pkgDir, 'testkit'), {recursive: true});
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({name}));
        const entry = path.join(pkgDir, 'testkit', 'index-testkit.ts');
        if (withExtension) fs.writeFileSync(entry, '');
        return fs.realpathSync(path.join(pkgDir, 'testkit')) + '/index-testkit.ts';
    }

    it('finds declared packages and installed @grest-ts packages nobody declared', async () => {
        dir = fs.mkdtempSync(path.join(tmpdir(), 'gg-ext-'));
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({dependencies: {'some-lib': '1.0.0'}}));
        const declared = install('some-lib', true);
        const transitive = install('@grest-ts/job', true);
        install('@grest-ts/schema', false);
        install('other-lib', true);

        expect(await new GGExtensionDiscovery('testkit').scan(dir)).toEqual([transitive, declared].sort());
    });
});
