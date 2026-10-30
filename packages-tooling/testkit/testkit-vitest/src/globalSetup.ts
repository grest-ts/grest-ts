import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {GGTestSharedRef} from "@grest-ts/testkit";

export function setup() {
    if (!process.env.GG_TEST_RUN_ID) {
        process.env.GG_TEST_RUN_ID = "r" + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    }
    if (!process.env.GG_TEST_SLOT) {
        process.env.GG_TEST_SLOT = String(claimSlot());
    }
}

export function teardown() {
    GGTestSharedRef.cleanup();
}

/** The lowest slot no live run holds. Resources a database can't free (dynamodb-local keeps a database's threads
 *  until it restarts) are keyed by slot, so they're reused run after run while concurrent runs stay apart. A slot is
 *  held for as long as this process lives; there is no release step to miss. */
function claimSlot(): number {
    const dir = path.join(os.tmpdir(), "gg-test-slots");
    fs.mkdirSync(dir, {recursive: true});
    for (let slot = 0; ; slot++) {
        const file = path.join(dir, String(slot));
        try {
            fs.writeFileSync(file, String(process.pid), {flag: "wx"});
            return slot;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        }
        let owner = 0;
        try { owner = Number(fs.readFileSync(file, "utf8")); } catch { /* released meanwhile: retry it */ }
        if (isAlive(owner)) continue;
        fs.rmSync(file, {force: true});
        slot--;
    }
}

function isAlive(pid: number): boolean {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === "EPERM";
    }
}
