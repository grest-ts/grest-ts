import type {GGTestRuntime} from "../GGTestRuntime";

/** What `.on()` narrows an interceptor to: one runtime, or one address. */
export type GGInterceptorTarget = GGTestRuntime | GGTestTarget;

/**
 * An address a call is sent to, for targets that have no test runtime (a fake row in a fan-out test, a third
 * party). Made with `GGTest.target("host:port")`.
 */
export class GGTestTarget {

    public readonly host: string;
    public readonly port: number;
    public readonly label: string;

    constructor(address: string) {
        const url = URL.parse(address.includes("://") ? address : "tcp://" + address);
        const port = url?.port ? Number(url.port) : url?.protocol === "https:" ? 443 : url?.protocol === "http:" ? 80 : undefined;
        if (!url?.hostname || port === undefined) {
            throw new Error(`GGTest.target("${address}"): expected "host:port" (an IPv6 host in brackets, "[::1]:9600") or an http(s) URL.`);
        }
        this.host = url.hostname.replace(/^\[|]$/g, "").toLowerCase();
        this.port = port;
        this.label = address;
    }
}
