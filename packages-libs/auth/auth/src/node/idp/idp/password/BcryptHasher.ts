import {createRequire} from "node:module"
import type {PasswordHasher} from "./PasswordHasher"

// bcrypt is a native module: importing it eagerly runs its node-gyp binding
// loader at module-eval, which crashes when this file is bundled (ESM) into a
// service that never hashes a password. Load it on first use instead.
let bcrypt: typeof import("bcrypt")
const lib = (): typeof import("bcrypt") => bcrypt ??= createRequire(import.meta.url)("bcrypt")

export class BcryptHasher implements PasswordHasher {

    private readonly rounds: number
    constructor(rounds: number = 10) {
        this.rounds = rounds
    }

    public hash = (password: string): Promise<string> => {
        return lib().hash(password, this.rounds)
    }

    public verify = (password: string, hash: string): Promise<boolean> => {
        return lib().compare(password, hash)
    }
}
