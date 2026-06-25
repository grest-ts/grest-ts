import {describe, it, expect} from "vitest";
import {
    IsString, IsNumber, IsArray, IsObject,
    IsEmail, IsDate, IsUrl,
    ERROR, GGContractClass, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {GGRpc, GGHttpSchema} from "@grest-ts/http";
import {toOpenApi} from "../src/toOpenApi";

// ---------------------------------------------------------------------------
// toOpenApi() — document-level tests
// Individual schema toJSONSchema() tests live in each schema's own spec file.
// ---------------------------------------------------------------------------

const NOT_FOUND = ERROR.define("NOT_FOUND", 404);
const UNAUTH = ERROR.define("UNAUTHORIZED", 401);
const VALIDATION = ERROR.define("VALIDATION_ERROR", 422, IsObject({field: IsString, message: IsString}));

const ItemSchema = IsObject({id: IsNumber, name: IsString});
const CreateItemInput = IsObject({name: IsString, price: IsNumber});

const ItemContract = new GGContractClass("ItemApi", {
    list: {
        success: IsArray(ItemSchema),
        errors: [NOT_FOUND, UNAUTH],
        permission: GG_NO_PERMISSIONS
    },
    get: {
        input: IsObject({id: IsNumber}),
        success: ItemSchema,
        errors: [NOT_FOUND],
        permission: GG_NO_PERMISSIONS
    },
    create: {
        input: CreateItemInput,
        success: ItemSchema,
        errors: [VALIDATION, UNAUTH],
        permission: GG_NO_PERMISSIONS
    },
    deleteItem: {
        input: IsObject({id: IsNumber}),
        errors: [NOT_FOUND, UNAUTH],
        permission: GG_NO_PERMISSIONS
    }
});

const ItemApi = new GGHttpSchema({
    contract: ItemContract,
    pathPrefix: "api/items",
    routes: {
        list: GGRpc.GET(""),
        get: GGRpc.GET(":id"),
        create: GGRpc.POST(""),
        deleteItem: GGRpc.DELETE(":id")
    }
});

describe("toOpenApi", () => {

    const doc = toOpenApi([ItemApi], {title: "Test API", version: "2.0.0"});

    it("produces OpenAPI 3.1.0 document", () => {
        expect(doc.openapi).toBe("3.1.0");
    });

    it("sets info correctly", () => {
        expect(doc.info.title).toBe("Test API");
        expect(doc.info.version).toBe("2.0.0");
    });

    it("has correct paths", () => {
        expect(Object.keys(doc.paths ?? {})).toContain("/api/items");
        expect(Object.keys(doc.paths ?? {})).toContain("/api/items/{id}");
    });

    describe("GET list", () => {
        const op = (doc.paths as any)?.["/api/items"]?.get;

        it("exists", () => expect(op).toBeDefined());
        it("has operationId namespaced as apiName_methodName", () => expect(op.operationId).toBe("ItemApi_list"));
        it("has summary derived from operationId", () => expect(op.summary).toBe("List"));
        it("has tag", () => expect(op.tags).toContain("ItemApi"));
        it("has 200 response with array schema", () => {
            const schema200 = op.responses["200"].content["application/json"].schema;
            expect(schema200.properties.data.type).toBe("array");
        });
        it("has 404 response", () => {
            expect(op.responses["404"]).toBeDefined();
        });
        it("has 401 response", () => {
            expect(op.responses["401"]).toBeDefined();
        });
    });

    describe("GET :id", () => {
        const op = (doc.paths as any)?.["/api/items/{id}"]?.get;

        it("exists", () => expect(op).toBeDefined());
        it("has path parameter", () => {
            const pathParam = op.parameters.find((p: any) => p.name === "id" && p.in === "path");
            expect(pathParam).toBeDefined();
            expect(pathParam.required).toBe(true);
        });
        it("path param uses actual type from input schema (IsNumber → number)", () => {
            const pathParam = op.parameters.find((p: any) => p.name === "id" && p.in === "path");
            expect(pathParam.schema.type).toBe("number");
        });
        it("has summary 'Get'", () => expect(op.summary).toBe("Get"));
    });

    describe("POST create", () => {
        const op = (doc.paths as any)?.["/api/items"]?.post;

        it("exists", () => expect(op).toBeDefined());
        it("has requestBody with application/json", () => {
            expect(op.requestBody.content["application/json"]).toBeDefined();
        });
        it("requestBody schema has correct shape", () => {
            const schema = op.requestBody.content["application/json"].schema;
            expect(schema.properties.name).toEqual({type: "string"});
            expect(schema.properties.price).toEqual({type: "number"});
        });
        it("has 422 error as $ref to Error_ValidationError component", () => {
            const err422 = op.responses["422"].content["application/json"].schema;
            // Error body is now extracted to components/schemas
            expect(err422.$ref).toBe("#/components/schemas/Error_ValidationError");
        });
        it("has 401 error", () => {
            expect(op.responses["401"]).toBeDefined();
        });
    });

    describe("DELETE :id", () => {
        const op = (doc.paths as any)?.["/api/items/{id}"]?.delete;

        it("exists", () => expect(op).toBeDefined());
        it("has 204 when no success schema", () => {
            expect(op.responses["204"]).toBeDefined();
        });
        it("has path param", () => {
            const p = op.parameters.find((x: any) => x.name === "id");
            expect(p?.in).toBe("path");
        });
    });

    describe("multiple errors same status code → oneOf", () => {
        const E400a = ERROR.define("ERR_A", 400);
        const E400b = ERROR.define("ERR_B", 400);
        const C = new GGContractClass("Mc", {
            do: {errors: [E400a, E400b],
                permission: GG_NO_PERMISSIONS
            }
        });
        const S = new GGHttpSchema({contract: C, pathPrefix: "mc", routes: {do: GGRpc.POST("do")}});
        const d = toOpenApi([S]);
        const op = (d.paths as any)?.["/mc/do"]?.post;

        it("merges into oneOf at 400", () => {
            const resp400 = op.responses["400"].content["application/json"].schema;
            expect(resp400.oneOf).toHaveLength(2);
        });
        it("error response description lists type names", () => {
            expect(op.responses["400"].description).toBe("ERR_A | ERR_B");
        });
    });

    describe("summary derivation", () => {
        const cases: [string, string][] = [
            ["list", "List"],
            ["getWatchedValue", "Get Watched Value"],
            ["createItem", "Create Item"],
            ["deleteItem", "Delete Item"],
        ];
        const C2 = new GGContractClass("X", {
            list: {permission: GG_NO_PERMISSIONS},
            getWatchedValue: {permission: GG_NO_PERMISSIONS},
            createItem: {permission: GG_NO_PERMISSIONS},
            deleteItem: {permission: GG_NO_PERMISSIONS},
        });
        const S2 = new GGHttpSchema({contract: C2, pathPrefix: "x", routes: {
            list: GGRpc.GET("list"),
            getWatchedValue: GGRpc.GET("gw"),
            createItem: GGRpc.POST("create"),
            deleteItem: GGRpc.DELETE("delete")
        }});
        const d2 = toOpenApi([S2]);
        for (const [method, expected] of cases) {
            it(`${method} → "${expected}"`, () => {
                const paths = d2.paths as any;
                const allOps = Object.values(paths as Record<string, any>)
                    .flatMap(p => Object.values(p as Record<string, any>))
                    .find((o: any) => o?.operationId === `X_${method}`) as any;
                expect(allOps?.summary).toBe(expected);
            });
        }
    });

    describe(".docs() enrichment in query params", () => {
        const DescribedInput = IsObject({
            query: IsString.docs({description: "Search term", example: "test"}),
            limit: IsNumber.orUndefined
        });
        const SearchContract = new GGContractClass("SearchApi", {
            search: {input: DescribedInput, success: IsArray(IsString),
                permission: GG_NO_PERMISSIONS
            }
        });
        const SearchApi = new GGHttpSchema({contract: SearchContract, pathPrefix: "search", routes: {
            search: GGRpc.GET("items")
        }});
        const d = toOpenApi([SearchApi]);
        const op = (d.paths as any)?.["/search/items"]?.get;

        it("query param carries description from docs", () => {
            const param = op.parameters.find((p: any) => p.name === "query");
            expect(param?.description).toBe("Search term");
        });
        it("optional query param has required:false", () => {
            const param = op.parameters.find((p: any) => p.name === "limit");
            expect(param?.required).toBe(false);
        });
    });

    describe("$ref deduplication via components/schemas", () => {
        const SharedType = IsObject({id: IsNumber, name: IsString})
            .docs({title: "Shared item"});
        const RefContract = new GGContractClass("RefApi", {
            get:    {success: SharedType, errors: [],
                permission: GG_NO_PERMISSIONS
            },
            list:   {success: IsArray(SharedType), errors: [],
                permission: GG_NO_PERMISSIONS
            },
        });
        const RefApi = new GGHttpSchema({contract: RefContract, pathPrefix: "ref", routes: {
            get:  GGRpc.GET(":id"),
            list: GGRpc.GET(""),
        }});
        const d = toOpenApi([RefApi]);

        it("named schema extracted to components/schemas", () => {
            const schemas = (d as any).components?.schemas ?? {};
            expect(schemas["SharedItem"]).toBeDefined();
            expect(schemas["SharedItem"].type).toBe("object");
        });

        it("get success data uses $ref not inline schema", () => {
            const op = (d.paths as any)["/ref/{id}"]?.get;
            const data = op.responses["200"].content["application/json"].schema.properties.data;
            expect(data.$ref).toBe("#/components/schemas/SharedItem");
        });

        it("list success data items uses $ref not inline schema", () => {
            const op = (d.paths as any)["/ref"]?.get;
            const data = op.responses["200"].content["application/json"].schema.properties.data;
            // data is an array — items should be the $ref
            expect(data.type).toBe("array");
            expect(data.items?.$ref).toBe("#/components/schemas/SharedItem");
        });

        it("schema without title stays inline (no $ref)", () => {
            const InlineContract = new GGContractClass("InlineApi", {
                get: {success: IsObject({x: IsNumber}), errors: [],
                    permission: GG_NO_PERMISSIONS
                }
            });
            const InlineApi = new GGHttpSchema({contract: InlineContract, pathPrefix: "il", routes: {
                get: GGRpc.GET("")
            }});
            const d2 = toOpenApi([InlineApi]);
            const data = (d2.paths as any)?.["/il"]?.get?.responses?.["200"]
                ?.content?.["application/json"]?.schema?.properties?.data;
            expect(data?.$ref).toBeUndefined();
            expect(data?.type).toBe("object");
            expect((d2 as any).components).toBeUndefined();
        });
    });

    describe("format hints on custom types", () => {
        const FormatContract = new GGContractClass("FormatApi", {
            get: {
                success: IsObject({
                    email: IsEmail,
                    date: IsDate,
                    url: IsUrl,
                }),
                errors: [],
                permission: GG_NO_PERMISSIONS
            }
        });
        const FormatApi = new GGHttpSchema({contract: FormatContract, pathPrefix: "fmt", routes: {
            get: GGRpc.GET("")
        }});
        const d = toOpenApi([FormatApi]);

        it("IsEmail produces format:email component", () => {
            const components = (d as any).components?.schemas ?? {};
            const email = components["EmailAddress"];
            expect(email?.format).toBe("email");
        });
        it("IsDate produces format:date component", () => {
            const components = (d as any).components?.schemas ?? {};
            expect(components["Date"]?.format).toBe("date");
        });
        it("IsUrl produces format:uri component", () => {
            const components = (d as any).components?.schemas ?? {};
            expect(components["URL"]?.format).toBe("uri");
        });
    });

    describe("options", () => {
        it("default title/version when options omitted", () => {
            const d = toOpenApi([ItemApi]);
            expect(d.info.title).toBe("API");
            expect(d.info.version).toBe("1.0.0");
        });
        it("servers propagated", () => {
            const d = toOpenApi([ItemApi], {servers: [{url: "https://api.example.com"}]});
            expect(d.servers?.[0].url).toBe("https://api.example.com");
        });
    });

    describe("codec contract enforcement", () => {
        const C = new GGContractClass("ThirdParty", {do: {permission: GG_NO_PERMISSIONS}});

        it("throws when toOpenApiOperation is missing", () => {
            const codecNoMethod = {
                method: "POST" as const, path: "do",
                createForClient: () => ({} as any), createForServer: () => ({} as any)
            };
            const S = new GGHttpSchema({contract: C, pathPrefix: "tp", routes: {do: codecNoMethod as any}});
            expect(() => toOpenApi([S])).toThrowError(/ThirdParty\.do/);
        });

        it("throws when toOpenApiOperation returns no responses", () => {
            const codecNoResponses = {
                method: "POST" as const, path: "do",
                createForClient: () => ({} as any), createForServer: () => ({} as any),
                toOpenApiOperation: () => ({operationId: "do", parameters: [] as any[]})
            };
            const S2 = new GGHttpSchema({contract: C, pathPrefix: "tp2", routes: {do: codecNoResponses as any}});
            expect(() => toOpenApi([S2])).toThrowError(/no responses/);
        });
    });
});
