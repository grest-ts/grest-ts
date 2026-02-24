import {tDateTime} from "@grest-ts/schema";


export type tUserId = number & { tUserId: true };

export interface User {
    id: tUserId;
    created_at: tDateTime,
    updated_at: tDateTime,
    username: string;
    age: number;
    isMan: number | null;
    created: tDateTime | null
    tin: number | null,
    uuid: string | null
}

export interface UserRowForEdit {
    username: unknown;
    age: unknown;
    isMan?: unknown;
    created?: unknown
    tin?: unknown
    uuid?: unknown
}