import * as crypto from 'crypto';
import {GGTestSharedRef} from "@grest-ts/testkit";

export function setup() {
    if (!process.env.GG_TEST_RUN_ID) {
        process.env.GG_TEST_RUN_ID = "r" + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    }
}

export function teardown() {
    GGTestSharedRef.cleanup();
}
