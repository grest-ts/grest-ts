import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {BcryptHasher} from "./BcryptHasher"
import type {PasswordHasher} from "./PasswordHasher"
import type {ExternalIdentity, IdpStrategy} from "../../IdpStrategy"

export interface PasswordCredential {
    username: string
    password: string
}

export interface PasswordRecord {
    // The subject the credential maps to (app's user id).
    subject: string
    passwordHash: string
}

export interface PasswordIdpOptions {
    // Resolves a username to its stored subject + password hash, or undefined if unknown.
    lookup: (username: string) => Promise<PasswordRecord | undefined>
    hasher?: PasswordHasher
    provider?: string
}

// Verifies a username/password credential against the app's stored hash → normalized identity.
// Unknown user and wrong password both throw CREDENTIALS_INVALID (no oracle for which failed).
export class PasswordIdp implements IdpStrategy<PasswordCredential> {

    public readonly provider: string
    private readonly lookup: (username: string) => Promise<PasswordRecord | undefined>
    private readonly hasher: PasswordHasher

    constructor(options: PasswordIdpOptions) {
        this.lookup = options.lookup
        this.hasher = options.hasher ?? new BcryptHasher()
        this.provider = options.provider ?? "password"
    }

    public authenticate = async (input: PasswordCredential): Promise<ExternalIdentity> => {
        const record = await this.lookup(input.username)
        if (!record || !(await this.hasher.verify(input.password, record.passwordHash))) {
            throw new NOT_AUTHORIZED({displayMessage: "Invalid username or password", debugMessage: "CREDENTIALS_INVALID"})
        }
        return {provider: this.provider, subject: record.subject, claims: {}}
    }
}
