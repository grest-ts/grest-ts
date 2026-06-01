import {describe, test, expect} from "vitest"
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {BcryptHasher, PasswordIdp, type PasswordRecord} from "."

describe("PasswordIdp", () => {
    const hasher = new BcryptHasher(4)

    async function idpWith(username: string, password: string) {
        const record: PasswordRecord = {subject: "user-1", passwordHash: await hasher.hash(password)}
        return new PasswordIdp({
            hasher,
            lookup: async (u) => (u === username ? record : undefined),
        })
    }

    test("verifies a correct credential and normalizes the identity", async () => {
        const idp = await idpWith("alice", "s3cret")
        const identity = await idp.authenticate({username: "alice", password: "s3cret"})
        expect(identity).toEqual({provider: "password", subject: "user-1", claims: {}})
    })

    test("rejects a wrong password with CREDENTIALS_INVALID", async () => {
        const idp = await idpWith("alice", "s3cret")
        await expect(idp.authenticate({username: "alice", password: "wrong"}))
            .rejects.toBeInstanceOf(NOT_AUTHORIZED)
    })

    test("rejects an unknown user with CREDENTIALS_INVALID", async () => {
        const idp = await idpWith("alice", "s3cret")
        await expect(idp.authenticate({username: "nobody", password: "s3cret"}))
            .rejects.toBeInstanceOf(NOT_AUTHORIZED)
    })

    test("provider defaults to 'password' and is overridable", async () => {
        const record: PasswordRecord = {subject: "u", passwordHash: await hasher.hash("p")}
        const idp = new PasswordIdp({hasher, provider: "local", lookup: async () => record})
        const identity = await idp.authenticate({username: "x", password: "p"})
        expect(identity.provider).toBe("local")
    })
})
