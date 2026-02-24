import type {TestDataDefinition} from "../../lib/TestRunner";

export interface RefineData {
    username: string;
    email: string;
    age: number;
    password: string;
    website: string;
}

export const refineTestData: TestDataDefinition<RefineData> = {
    category: "refine",
    correctObj: {
        username: "johndoe123",
        email: "john.doe@example.com",
        age: 25,
        password: "SecurePass123!",
        website: "https://example.com",
        EXTRA: "should be stripped"
    },
    wrongObj: {
        username: "ab",
        email: "invalid-email",
        age: 15,
        password: "weak",
        website: "not-a-url"
    },
    expectedErrorPaths: ["username", "email", "age", "password", "website"]
};
