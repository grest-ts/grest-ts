import bcrypt from "bcrypt"
import type {PasswordHasher} from "./PasswordHasher"

export class BcryptHasher implements PasswordHasher {

    constructor(private readonly rounds: number = 10) {}

    public hash = (password: string): Promise<string> => {
        return bcrypt.hash(password, this.rounds)
    }

    public verify = (password: string, hash: string): Promise<boolean> => {
        return bcrypt.compare(password, hash)
    }
}
