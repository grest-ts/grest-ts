import type {TestDataDefinition} from "../../lib/TestRunner";

export interface DiscriminatedUser {
    type: 'user';
    name: string;
    email: string;
}

export interface DiscriminatedAdmin {
    type: 'admin';
    name: string;
    email: string;
    level: number;
}

export interface DiscriminatedGuest {
    type: 'guest';
    sessionId: string;
}

export type DiscriminatedData = DiscriminatedUser | DiscriminatedAdmin | DiscriminatedGuest;


export const discriminatedTestData: TestDataDefinition<DiscriminatedData> = {
    category: "discriminated",
    correctObj: {
        type: 'user',
        name: 'John Doe',
        email: 'john@example.com',
        EXTRA: "should be stripped"
    } as DiscriminatedData & { EXTRA?: string },
    wrongObj: {
        type: 'unknown',
        name: 'Unknown User'
    },
    expectedErrorPaths: ["type"]  // invalid discriminator value
};
