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
    // Runs starting together take turns, so none reads a half-written claim or replaces one just made.
    const lock = path.join(dir, "lock");
    for (let since = Date.now(); ;) {
        try { fs.mkdirSync(lock); break; } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        }
        // A holder that died mid-claim never lets go; a claim takes milliseconds.
        if (Date.now() - since > 10_000) { fs.rmSync(lock, {recursive: true, force: true}); since = Date.now(); }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    try {
        for (let slot = 0; ; slot++) {
            const file = path.join(dir, String(slot));
            if (fs.existsSync(file) && isAlive(Number(fs.readFileSync(file, "utf8")))) continue;
            fs.writeFileSync(file, String(process.pid));
            return slot;
        }
    } finally {
        fs.rmSync(lock, {recursive: true, force: true});
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
