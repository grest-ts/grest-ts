import {describe, it, expect} from "vitest";
import {GGContext, type GGInbound} from "@grest-ts/context";
import {FORBIDDEN} from "@grest-ts/schema";
import {GGLoopbackGuard, isLoopbackAddress} from "./GGLoopbackGuard";

const inbound = (peerAddress: string | undefined): GGInbound => ({headers: {}, query: {}, peerAddress});

describe("isLoopbackAddress", () => {
    it.each(["127.0.0.1", "127.0.0.5", "127.1.2.3", "::1", "::ffff:127.0.0.1"])(
        "accepts loopback %s",
        (addr) => expect(isLoopbackAddress(addr)).toBe(true),
    );

    it.each([undefined, "", "10.86.144.1", "77.42.10.207", "::2", "::ffff:10.0.0.1", "0.0.0.0"])(
        "rejects non-loopback %s",
        (addr) => expect(isLoopbackAddress(addr as string | undefined)).toBe(false),
    );
});

describe("GGLoopbackGuard", () => {
    const run = (peerAddress: string | undefined) =>
        new GGContext("test").run(async () => {
            const guard = new GGLoopbackGuard("loopback-test");
            guard.parse(inbound(peerAddress));
            await guard.process();
        });

    it("passes a loopback peer", async () => {
        await expect(run("127.0.0.1")).resolves.toBeUndefined();
    });

    it("rejects a non-loopback peer with FORBIDDEN", async () => {
        await expect(run("77.42.10.207")).rejects.toBeInstanceOf(FORBIDDEN);
    });

    it("fails closed when the peer address is unknown", async () => {
        await expect(run(undefined)).rejects.toBeInstanceOf(FORBIDDEN);
    });
});
