// Hashes and verifies passwords. BcryptHasher is the default; swap for argon2 etc. via the interface.
export interface PasswordHasher {
    hash(password: string): Promise<string>
    verify(password: string, hash: string): Promise<boolean>
}
