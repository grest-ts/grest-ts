import {describe, expect, it} from "vitest";
import {GGLocatorScope} from "@grest-ts/locator";
import {GGContractClass, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema";
import {GGHttpSchema} from "../schema/GGHttpSchema";
import {GGRpc} from "../rpc/GGHttpRouteRPC";
import {GGHttpServer} from "./GGHttpServer";
import {GGHttp} from "./GGHttp";
import "../index-node";

const EchoApi = new GGHttpSchema({
    contract: new GGContractClass("EchoApi", {
        echo: {input: IsObject({text: IsString}), success: IsString, errors: [SERVER_ERROR], description: "Says it back."},
    }),
    pathPrefix: "api/echo",
    routes: {echo: GGRpc.POST("echo")},
});

/** A scope that owns the server's lifecycle as a runtime would; the server is never started. */
function inScope(fn: () => void): void {
    const scope = new GGLocatorScope("registry-test");
    scope.setLifecycleOwner(() => undefined);
    scope.run(fn);
}

describe("GGHttpServer registry", () => {
    it("records each registered schema's implementation", () => {
        inScope(() => {
            const server = new GGHttpServer();
            const impl = {echo: async ({text}: {text: string}) => text};
            new GGHttp(server).http(EchoApi, impl);
            expect(server.registeredSchemas).toEqual([EchoApi]);
            expect(server.implementationOf(EchoApi)).toBe(impl);
            expect(EchoApi.contract.methods.echo.description).toBe("Says it back.");
        });
    });

    it("knows no implementation for a schema it doesn't serve", () => {
        inScope(() => {
            expect(new GGHttpServer().implementationOf(EchoApi)).toBeUndefined();
        });
    });
});
