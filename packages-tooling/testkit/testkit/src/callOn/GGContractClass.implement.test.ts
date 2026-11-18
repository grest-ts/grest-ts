import {describe, expect, it} from "vitest"
import {GGContractClass, IsString, SERVER_ERROR} from "@grest-ts/schema"
import {GGLocatorScope} from "@grest-ts/locator"
import "./GGContractClass.implement"

const methods = {ping: {success: IsString, errors: [SERVER_ERROR]}}
const impl = () => ({ping: async () => "pong"})

describe("implement registers a contract for callOn", () => {
    it("registers one implementation served through two schemas once", () => {
        const contract = new GGContractClass("Twice", methods)
        const instance = impl()
        new GGLocatorScope("test").run(() => {
            contract.implement(instance)
            expect(() => contract.implement(instance)).not.toThrow()
        })
    })

    it("throws for another implementation, or another contract of the same name", () => {
        const contract = new GGContractClass("Clash", methods)
        const instance = impl()
        new GGLocatorScope("test").run(() => {
            contract.implement(instance)
            expect(() => contract.implement(impl())).toThrow("already registered")
            expect(() => new GGContractClass("Clash", methods).implement(instance)).toThrow("already registered")
        })
    })
})
