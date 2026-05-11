import {describe, expect, it} from "vitest";
import {GGContractClass} from "../GGContractClass";
import {GGContractFunction} from "../GGContractFunction";
import {FORBIDDEN, NOT_AUTHORIZED} from "../standardErrors";
import {SERVER_ERROR} from "../ERROR";
import {GG_NO_PERMISSIONS} from "./GGPermission";
import {IsString} from "../../schemas/IsString";

describe("contract construction permission/errors enforcement", () => {

    describe("GGContractClass", () => {

        it("public method does not require NOT_AUTHORIZED/FORBIDDEN in errors", () => {
            expect(() => new GGContractClass("Public", {
                ping: {success: IsString, errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS},
            })).not.toThrow();
        });

        it("public method works with no errors array at all", () => {
            expect(() => new GGContractClass("Public2", {
                ping: {success: IsString, permission: GG_NO_PERMISSIONS},
            })).not.toThrow();
        });

        it("non-public method requires NOT_AUTHORIZED in errors", () => {
            expect(() => new GGContractClass("MissingUnauth", {
                read: {success: IsString, errors: [FORBIDDEN, SERVER_ERROR], permission: "items:read"},
            })).toThrow(/NOT_AUTHORIZED.+FORBIDDEN/);
        });

        it("non-public method requires FORBIDDEN in errors", () => {
            expect(() => new GGContractClass("MissingForbidden", {
                read: {success: IsString, errors: [NOT_AUTHORIZED, SERVER_ERROR], permission: "items:read"},
            })).toThrow(/NOT_AUTHORIZED.+FORBIDDEN/);
        });

        it("non-public method with no errors array throws", () => {
            expect(() => new GGContractClass("NoErrors", {
                read: {success: IsString, permission: "items:read"},
            })).toThrow(/NOT_AUTHORIZED.+FORBIDDEN/);
        });

        it("non-public method with both NOT_AUTHORIZED and FORBIDDEN passes", () => {
            expect(() => new GGContractClass("OK", {
                read: {success: IsString, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR], permission: "items:read"},
            })).not.toThrow();
        });

        it("error message names the offending method", () => {
            try {
                new GGContractClass("MyApi", {
                    bad: {success: IsString, errors: [SERVER_ERROR], permission: "x"},
                });
                throw new Error("should have thrown");
            } catch (e: any) {
                expect(e.message).toContain("MyApi.bad");
            }
        });

        it("non-empty array of GG_NO_PERMISSIONS methods alongside a bad protected method still throws", () => {
            expect(() => new GGContractClass("Mixed", {
                publicOne: {success: IsString, errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS},
                protectedOne: {success: IsString, errors: [SERVER_ERROR], permission: "x"},
            })).toThrow(/protectedOne/);
        });
    });

    describe("GGContractFunction", () => {

        it("public function does not require NOT_AUTHORIZED/FORBIDDEN", () => {
            expect(() => new GGContractFunction({
                success: IsString,
                errors: [SERVER_ERROR],
                permission: GG_NO_PERMISSIONS,
            })).not.toThrow();
        });

        it("non-public function requires NOT_AUTHORIZED in errors", () => {
            expect(() => new GGContractFunction({
                success: IsString,
                errors: [FORBIDDEN, SERVER_ERROR],
                permission: "x",
            })).toThrow(/NOT_AUTHORIZED.+FORBIDDEN/);
        });

        it("non-public function requires FORBIDDEN in errors", () => {
            expect(() => new GGContractFunction({
                success: IsString,
                errors: [NOT_AUTHORIZED, SERVER_ERROR],
                permission: "x",
            })).toThrow(/NOT_AUTHORIZED.+FORBIDDEN/);
        });

        it("non-public function with both passes", () => {
            expect(() => new GGContractFunction({
                success: IsString,
                errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
                permission: "x",
            })).not.toThrow();
        });
    });

    describe("permission tree validation at construction time", () => {

        it("rejects empty allOf array (bypassed via `as`)", () => {
            expect(() => new GGContractClass("Bad", {
                x: {success: IsString, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR], permission: {allOf: []} as any},
            })).toThrow(/at least one/);
        });

        it("rejects depth exceeding MAX_DEPTH", () => {
            const tooDeep: any = {anyOf: [{allOf: [{anyOf: [{allOf: [{anyOf: ["a"]}]}]}]}]};
            expect(() => new GGContractClass("Bad", {
                x: {success: IsString, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR], permission: tooDeep},
            })).toThrow(/too deep/);
        });
    });
});
