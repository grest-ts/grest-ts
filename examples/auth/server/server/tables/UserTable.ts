import {tUserId, User, UserPermission} from "../../../api/auth/UserAuth"

export interface UserRecord extends User {
    password: string
    permissions: UserPermission[]
}

export class UserTable {
    private readonly users = new Map<tUserId, UserRecord>()
    private nextId = 1

    public create(data: {username: string, email: string, password: string, permissions: UserPermission[]}): UserRecord {
        const id = `user-${this.nextId++}` as tUserId
        const record: UserRecord = {id, ...data}
        this.users.set(id, record)
        return record
    }

    public findByUsername(username: string): UserRecord | undefined {
        return [...this.users.values()].find(u => u.username === username)
    }

    public getRecord(id: tUserId): UserRecord | undefined {
        return this.users.get(id)
    }

    public get(id: tUserId): User | undefined {
        const r = this.users.get(id)
        return r ? {id: r.id, username: r.username, email: r.email, permissions: r.permissions} : undefined
    }

    public update(id: tUserId, patch: Partial<Pick<UserRecord, "email">>): UserRecord | undefined {
        const record = this.users.get(id)
        if (!record) return undefined
        if (patch.email !== undefined) record.email = patch.email
        return record
    }
}
