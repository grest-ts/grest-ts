import type {TestDataDefinition} from "../../lib/TestRunner";

export interface NestedData {
    id: number;
    user: {
        name: string;
        email: string;
        profile: {
            bio: string;
            website: string;
            social: {
                twitter: string;
                github: string;
            };
        };
    };
    metadata: {
        createdAt: number;
        updatedAt: number;
        version: number;
    };
    tags: string[];
}


export const nestedTestData: TestDataDefinition<NestedData> = {
    category: "nested",
    correctObj: {
        id: 12345,
        user: {
            name: "John Doe",
            email: "john@example.com",
            profile: {
                bio: "Software developer",
                website: "https://example.com",
                social: {
                    twitter: "@johndoe",
                    github: "johndoe"
                }
            }
        },
        metadata: {
            createdAt: 1704067200,
            updatedAt: 1704153600,
            version: 1
        },
        tags: ["featured", "verified"],
        EXTRA: "should be stripped"
    },
    wrongObj: {
        id: "not-a-number",
        user: {
            name: 123,
            email: "john@example.com",
            profile: {
                bio: "Software developer",
                website: null,
                social: {
                    twitter: 123,
                    github: "johndoe"
                }
            }
        },
        metadata: {
            createdAt: "invalid",
            updatedAt: 1704153600,
            version: "one"
        },
        tags: "not-an-array"
    },
    expectedErrorPaths: ["id", "user.name", "user.profile.website", "user.profile.social.twitter", "metadata.createdAt", "metadata.version", "tags"]
};
