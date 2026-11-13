import type {GGConnectionSettings} from "@grest-ts/context";
import {GG_TEST_RUNTIME_WORKER} from "@grest-ts/testkit";
import {_registerNodeDefaultTransport, GGHttpTransport} from "../../src/client/GGHttpSchema.createClient";
// Registers the real default first, so the test transport below is the one that stays.
import "../../src/client/GGHttpSchema.createClient.node.js";
import {nodeDefaultTransport} from "../../src/client/nodeConnectionTransport.node.js";

export const DESTINATION_HEADER = "x-gg-test-destination";

/** Where a client-addressed call would be dialled: the client's base URL plus its connection settings. */
export interface GGHttpTestDestination {
    url: string
    settings?: GGConnectionSettings
}

export function encodeDestination(destination: GGHttpTestDestination): string {
    return Buffer.from(JSON.stringify(destination)).toString("base64");
}

export function decodeDestination(header: string): GGHttpTestDestination {
    return JSON.parse(Buffer.from(header, "base64").toString());
}

/**
 * In a test runtime, a call a client addresses itself (a fixed `url`, or a host in its connection settings) goes
 * to the test router with its destination in a header, like a discovery call does without one. The router answers
 * it from a mock, or dials the destination with the real transport and the same settings.
 */
const testTransport: GGHttpTransport = (url, init) => {
    const worker = GG_TEST_RUNTIME_WORKER.tryGet();
    const baseUrl = url.slice(0, url.length - init.path.length);
    const router = `http://localhost:${worker?.config.testRouterPort}`;
    // No base URL and no host is a call that can't be dialled; it must fail in a test as it does in production.
    if (!worker || baseUrl === router || (baseUrl === "" && !init.connectionSettings?.host)) {
        return nodeDefaultTransport(url, init);
    }
    const {connectionSettings, ...rest} = init;
    return nodeDefaultTransport(router + init.path, {
        ...rest,
        headers: {...init.headers, [DESTINATION_HEADER]: encodeDestination({url: baseUrl, settings: connectionSettings})},
    });
}

_registerNodeDefaultTransport(testTransport);
