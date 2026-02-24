import {ALPHANUMERIC_PATTERN, EMAIL_PATTERN, PASSWORD_PATTERN, URL_PATTERN} from "../regexPatterns";

// Schema definitions - NO additionalProperties: false
// (removeAdditional: "all" handles stripping, schemas just define structure)
export const simpleSchema = {
    type: "object",
    properties: {
        name: {type: "string", minLength: 1, maxLength: 100},
        age: {type: "number", minimum: 0, maximum: 150},
        email: {type: "string", minLength: 1},
        active: {type: "boolean"},
        tags: {type: "array", items: {type: "string"}}
    },
    required: ["name", "age", "email", "active", "tags"]
};

export const nestedSchema = {
    type: "object",
    properties: {
        id: {type: "number"},
        user: {
            type: "object",
            properties: {
                name: {type: "string", minLength: 1},
                email: {type: "string", minLength: 1},
                profile: {
                    type: "object",
                    properties: {
                        bio: {type: "string"},
                        website: {type: "string"},
                        social: {
                            type: "object",
                            properties: {
                                twitter: {type: "string"},
                                github: {type: "string"}
                            },
                            required: ["twitter", "github"]
                        }
                    },
                    required: ["bio", "website", "social"]
                }
            },
            required: ["name", "email", "profile"]
        },
        metadata: {
            type: "object",
            properties: {
                createdAt: {type: "number"},
                updatedAt: {type: "number"},
                version: {type: "number"}
            },
            required: ["createdAt", "updatedAt", "version"]
        },
        tags: {type: "array", items: {type: "string"}}
    },
    required: ["id", "user", "metadata", "tags"]
};

export const refineSchema = {
    type: "object",
    properties: {
        username: {type: "string", minLength: 3, maxLength: 20, pattern: ALPHANUMERIC_PATTERN},
        email: {type: "string", pattern: EMAIL_PATTERN},
        age: {type: "number", minimum: 18, maximum: 150},
        password: {type: "string", pattern: PASSWORD_PATTERN},
        website: {type: "string", pattern: URL_PATTERN}
    },
    required: ["username", "email", "age", "password", "website"]
};

export const discriminatedSchema = {
    type: "object",  // Required for discriminator in strict mode
    discriminator: {propertyName: "type"},
    oneOf: [
        {
            type: "object",
            properties: {
                type: {const: "user"},
                name: {type: "string", minLength: 1},
                email: {type: "string", minLength: 1}
            },
            required: ["type", "name", "email"]
        },
        {
            type: "object",
            properties: {
                type: {const: "admin"},
                name: {type: "string", minLength: 1},
                email: {type: "string", minLength: 1},
                level: {type: "number", minimum: 1, maximum: 10}
            },
            required: ["type", "name", "email", "level"]
        },
        {
            type: "object",
            properties: {
                type: {const: "guest"},
                sessionId: {type: "string", minLength: 1}
            },
            required: ["type", "sessionId"]
        }
    ]
};

export const recursiveSchema = {
    $id: "recursiveData",
    type: "object",
    properties: {
        name: {type: "string"},
        value: {type: "number"},
        children: {
            type: "array",
            items: {$ref: "recursiveData"}
        }
    },
    required: ["name", "value"]
};

export const tupleSchema = {
    type: "object",
    properties: {
        coords: {type: "array", items: [{type: "number"}, {type: "number"}, {type: "number"}], minItems: 3, maxItems: 3},
        range: {type: "array", items: [{type: "number"}, {type: "number"}], minItems: 2, maxItems: 2},
        mixed: {type: "array", items: [{type: "string"}, {type: "number"}, {type: "boolean"}], minItems: 3, maxItems: 3}
    },
    required: ["coords", "range", "mixed"]
};

export const bigStringSchema = {
    type: "object",
    properties: {
        content: {type: "string"},
        description: {type: "string"},
        metadata: {type: "string"}
    },
    required: ["content", "description", "metadata"]
};

export const bigArraySchema = {
    type: "object",
    properties: {
        items: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: {type: "number"},
                    name: {type: "string"},
                    value: {type: "number"}
                },
                required: ["id", "name", "value"]
            }
        }
    },
    required: ["items"]
};

export const numberSchema = {
    type: "number"
};
