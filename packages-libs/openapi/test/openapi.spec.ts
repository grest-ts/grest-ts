import {describe, it, expect} from "vitest";
import {
    IsString, IsNumber, IsBoolean, IsArray, IsObject, IsLiteral,
    IsUnion, IsRecord, IsTuple, IsAny, IsUnknown, IsBit,
    IsDiscriminated, ERROR, GGContractClass,
    IsInt, IsUint, IsUint8
} from "@grest-ts/schema";
import {GGRpc, httpSchema} from "@grest-ts/http";
import {toOpenApi} from "../src/toOpenApi";

// ---------------------------------------------------------------------------
// toJSONSchema() — schema-level tests
// ---------------------------------------------------------------------------

describe("toJSONSchema", () => {

    describe("IsString", () => {
        it("basic", () => {
            expect(IsString.toJSONSchema()).toEqual({type: "string"});
        });
        it("minLength / maxLength", () => {
            expect(IsString.minLength(2).maxLength(10).toJSONSchema())
                .toEqual({type: "string", minLength: 2, maxLength: 10});
        });
        it("nonEmpty implies minLength:1", () => {
            expect(IsString.nonEmpty.toJSONSchema()).toEqual({type: "string", minLength: 1});
        });
        it("nonEmpty + explicit minLength keeps larger", () => {
            expect(IsString.nonEmpty.minLength(3).toJSONSchema())
                .toEqual({type: "string", minLength: 3});
        });
        it("pattern", () => {
            const s = IsString.regex(/^[a-z]+$/);
            expect((s.toJSONSchema() as any).pattern).toBe("^[a-z]+$");
        });
        it("nullable wraps in oneOf", () => {
            expect(IsString.orNull.toJSONSchema())
                .toEqual({oneOf: [{type: "string"}, {type: "null"}]});
        });
        it("optional keeps the type intact (optional is structural, not JSON Schema)", () => {
            expect(IsString.orUndefined.toJSONSchema()).toEqual({type: "string"});
        });
    });

    describe("IsNumber / integer variants", () => {
        it("float number", () => {
            expect(IsNumber.toJSONSchema()).toEqual({type: "number"});
        });
        it("integer", () => {
            expect(IsInt.toJSONSchema()).toEqual({type: "integer"});
        });
        it("uint (min:0)", () => {
            expect(IsUint.toJSONSchema()).toEqual({type: "integer", minimum: 0});
        });
        it("uint8 (min:0 max:255)", () => {
            expect(IsUint8.toJSONSchema()).toEqual({type: "integer", minimum: 0, maximum: 255});
        });
        it("with min/max override", () => {
            expect(IsNumber.min(0).max(100).toJSONSchema())
                .toEqual({type: "number", minimum: 0, maximum: 100});
        });
        it("multipleOf", () => {
            expect(IsNumber.multipleOf(5).toJSONSchema())
                .toEqual({type: "number", multipleOf: 5});
        });
        it("nullable", () => {
            expect(IsNumber.orNull.toJSONSchema())
                .toEqual({oneOf: [{type: "number"}, {type: "null"}]});
        });
    });

    describe("IsBoolean", () => {
        it("basic", () => {
            expect(IsBoolean.toJSONSchema()).toEqual({type: "boolean"});
        });
        it("nullable", () => {
            expect(IsBoolean.orNull.toJSONSchema())
                .toEqual({oneOf: [{type: "boolean"}, {type: "null"}]});
        });
    });

    describe("IsBit", () => {
        it("basic", () => {
            expect(IsBit.toJSONSchema()).toEqual({type: "integer", minimum: 0, maximum: 1});
        });
    });

    describe("IsLiteral", () => {
        it("single string", () => {
            expect(IsLiteral("admin").toJSONSchema()).toEqual({enum: ["admin"]});
        });
        it("multiple values", () => {
            expect(IsLiteral("a", "b", "c").toJSONSchema()).toEqual({enum: ["a", "b", "c"]});
        });
        it("mixed string+number", () => {
            expect(IsLiteral(1, 2, "three").toJSONSchema()).toEqual({enum: [1, 2, "three"]});
        });
        it("nullable", () => {
            expect(IsLiteral("x").orNull.toJSONSchema())
                .toEqual({oneOf: [{enum: ["x"]}, {type: "null"}]});
        });
    });

    describe("IsArray", () => {
        it("basic", () => {
            expect(IsArray(IsString).toJSONSchema())
                .toEqual({type: "array", items: {type: "string"}});
        });
        it("with minLength / maxLength", () => {
            expect(IsArray(IsNumber).minLength(1).maxLength(5).toJSONSchema())
                .toEqual({type: "array", items: {type: "number"}, minItems: 1, maxItems: 5});
        });
        it("nested array", () => {
            expect(IsArray(IsArray(IsBoolean)).toJSONSchema())
                .toEqual({type: "array", items: {type: "array", items: {type: "boolean"}}});
        });
        it("nullable", () => {
            const s = IsArray(IsString).orNull.toJSONSchema();
            expect((s as any).oneOf[0].type).toBe("array");
        });
    });

    describe("IsObject", () => {
        it("basic — all required", () => {
            const s = IsObject({name: IsString, age: IsNumber});
            expect(s.toJSONSchema()).toEqual({
                type: "object",
                properties: {
                    name: {type: "string"},
                    age: {type: "number"}
                },
                required: ["name", "age"]
            });
        });
        it("optional fields excluded from required", () => {
            const s = IsObject({name: IsString, nickname: IsString.orUndefined});
            const json = s.toJSONSchema() as any;
            expect(json.required).toEqual(["name"]);
            expect(json.properties.nickname).toEqual({type: "string"});
        });
        it("no required array when all optional", () => {
            const s = IsObject({a: IsString.orUndefined});
            const json = s.toJSONSchema() as any;
            expect(json.required).toBeUndefined();
        });
        it("nullable", () => {
            const s = IsObject({x: IsNumber}).orNull.toJSONSchema() as any;
            expect(s.oneOf[0].type).toBe("object");
            expect(s.oneOf[1].type).toBe("null");
        });
    });

    describe("IsRecord", () => {
        it("basic", () => {
            expect(IsRecord(IsString, IsNumber).toJSONSchema())
                .toEqual({type: "object", additionalProperties: {type: "number"}});
        });
    });

    describe("IsUnion", () => {
        it("basic", () => {
            const s = IsUnion(IsString, IsNumber);
            expect(s.toJSONSchema()).toEqual({oneOf: [{type: "string"}, {type: "number"}]});
        });
        it("nullable", () => {
            const s = IsUnion(IsString, IsNumber).orNull.toJSONSchema() as any;
            expect(s.oneOf).toHaveLength(2);
        });
    });

    describe("IsDiscriminated", () => {
        const Circle = IsObject({kind: IsLiteral("circle"), r: IsNumber});
        const Square = IsObject({kind: IsLiteral("square"), side: IsNumber});
        const Shape = IsDiscriminated("kind", {circle: Circle, square: Square});

        it("produces oneOf + discriminator", () => {
            const json = Shape.toJSONSchema() as any;
            expect(json.discriminator).toEqual({propertyName: "kind"});
            expect(json.oneOf).toHaveLength(2);
        });
    });

    describe("IsTuple", () => {
        it("basic", () => {
            const s = IsTuple(IsString, IsNumber).toJSONSchema() as any;
            expect(s.type).toBe("array");
            expect(s.prefixItems).toEqual([{type: "string"}, {type: "number"}]);
            expect(s.minItems).toBe(2);
            expect(s.maxItems).toBe(2);
        });
    });

    describe("IsAny / IsUnknown", () => {
        it("IsAny → {}", () => {
            expect(IsAny.toJSONSchema()).toEqual({});
        });
        it("IsUnknown → {}", () => {
            expect(IsUnknown.toJSONSchema()).toEqual({});
        });
    });
});

// ---------------------------------------------------------------------------
// toOpenApi() — document-level tests
// ---------------------------------------------------------------------------

const NOT_FOUND = ERROR.define("NOT_FOUND", 404);
const UNAUTH = ERROR.define("UNAUTHORIZED", 401);
const VALIDATION = ERROR.define("VALIDATION_ERROR", 422, IsObject({field: IsString, message: IsString}));

const ItemSchema = IsObject({id: IsNumber, name: IsString});
const CreateItemInput = IsObject({name: IsString, price: IsNumber});

const ItemContract = new GGContractClass("ItemApi", {
    list: {
        success: IsArray(ItemSchema),
        errors: [NOT_FOUND, UNAUTH]
    },
    get: {
        input: IsObject({id: IsNumber}),
        success: ItemSchema,
        errors: [NOT_FOUND]
    },
    create: {
        input: CreateItemInput,
        success: ItemSchema,
        errors: [VALIDATION, UNAUTH]
    },
    deleteItem: {
        input: IsObject({id: IsNumber}),
        errors: [NOT_FOUND, UNAUTH]
    }
});

const ItemApi = httpSchema(ItemContract)
    .pathPrefix("api/items")
    .routes({
        list: GGRpc.GET(""),
        get: GGRpc.GET(":id"),
        create: GGRpc.POST(""),
        deleteItem: GGRpc.DELETE(":id")
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
        it("has operationId", () => expect(op.operationId).toBe("list"));
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
        it("has 422 error with data schema", () => {
            const err422 = op.responses["422"].content["application/json"].schema;
            expect(err422.properties.type.enum).toContain("VALIDATION_ERROR");
            expect(err422.properties.data).toBeDefined();
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
            do: {errors: [E400a, E400b]}
        });
        const S = httpSchema(C).pathPrefix("mc").routes({do: GGRpc.POST("do")});
        const d = toOpenApi([S]);
        const op = (d.paths as any)?.["/mc/do"]?.post;

        it("merges into oneOf at 400", () => {
            const resp400 = op.responses["400"].content["application/json"].schema;
            expect(resp400.oneOf).toHaveLength(2);
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
});
