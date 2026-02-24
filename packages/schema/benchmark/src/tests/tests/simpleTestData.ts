import type {TestDataDefinition} from "../../lib/TestRunner";

export interface SimpleData {
    name: string;
    age: number;
    email: string;
    active: boolean;
    tags: string[];
}

export const simpleTestData: TestDataDefinition<SimpleData> = {
    category: "simple",
    correctObj: {
        name: "John Doe",
        age: 30,
        email: "john@example.com",
        active: true,
        tags: ["user", "admin", "verified"],
        EXTRA: "this should be stripped"
    },
    wrongObj: {
        name: 123,
        age: "thirty",
        email: null,
        active: "yes",
        tags: "not-an-array"
    },
    expectedErrorPaths: ["name", "age", "email", "active", "tags"]
};
