import {describe, it, expect} from "vitest";
import {GGParseError} from "./GGParseError";
import {GGIssuesList} from "./GGIssuesList";
import {IsObject} from "../schemas/IsObject";
import {IsNumber} from "../schemas/IsNumber";

const IsCredentials = IsObject({token: IsNumber});
const SECRET = "ghp_supersecret123";

function catchError(fn: () => unknown): unknown {
    try {
        fn();
    } catch (e) {
        return e;
    }
    expect.unreachable();
}

describe("GGParseError", () => {

    it("parse() throws GGParseError carrying the issues", () => {
        const e = catchError(() => IsCredentials.parse({token: SECRET}));
        expect(e).toBeInstanceOf(GGParseError);
        expect(e).toBeInstanceOf(Error);
        const err = e as GGParseError;
        expect(err.name).toBe("GGParseError");
        expect(err.issues).toBeInstanceOf(GGIssuesList);
        expect(err.issues.length).toBe(1);
        expect(err.issues.getPath(0)).toBe("token");
        expect(err.message).toBe(err.issues.toString());
        expect(err.stack).toContain("GGParseError: Validation failed: token:");
    });

    it("assert() throws GGParseError carrying the issues", () => {
        const e = catchError(() => IsCredentials.assert({token: SECRET}));
        expect(e).toBeInstanceOf(GGParseError);
        expect((e as GGParseError).issues.getPath(0)).toBe("token");
    });

    it("message does not contain the failing value", () => {
        const e = catchError(() => IsCredentials.parse({token: SECRET})) as GGParseError;
        expect(e.message).not.toContain(SECRET);
        expect(e.stack).not.toContain(SECRET);
        expect(String(e)).not.toContain(SECRET);
    });

    it("safeParse() still returns the issues list", () => {
        const result = IsCredentials.safeParse({token: SECRET});
        expect(result.success).toBe(false);
        if (!result.success) expect(result.issues).toBeInstanceOf(GGIssuesList);
    });
});
