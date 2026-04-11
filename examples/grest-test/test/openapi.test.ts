/**
 * OpenAPI snapshot test.
 *
 * Generates the full OpenAPI 3.1 spec from ShowcaseApi — a rich API definition
 * that exercises every structurally interesting schema type — and snapshots the
 * result. Any future change that alters the generated spec must update the snapshot
 * intentionally, making regressions immediately visible.
 *
 * To update the snapshot after an intentional change: run vitest with --update-snapshots.
 */
import {describe, it, expect} from "vitest";
import {toOpenApi} from "@grest-ts/openapi";
import {ShowcaseApi} from "../src/api/OpenApiShowcaseApi";

describe("OpenAPI spec — ShowcaseApi snapshot", () => {

    const doc = toOpenApi([ShowcaseApi], {
        title: "Showcase API",
        version: "1.0.0",
        description: "Integration snapshot for @grest-ts/openapi spec generation",
    });

    it("matches snapshot", () => {
        expect(doc).toMatchSnapshot();
    });

    // A handful of structural assertions complement the snapshot, giving clearer
    // failure messages when something fundamentally wrong happens.

    it("is OpenAPI 3.1.0", () => {
        expect(doc.openapi).toBe("3.1.0");
    });

    it("has expected paths", () => {
        const paths = Object.keys(doc.paths ?? {});
        expect(paths).toContain("/api/showcase/users");
        expect(paths).toContain("/api/showcase/users/{id}");
        expect(paths).toContain("/api/showcase/stats");
        expect(paths).toContain("/api/showcase/users/{id}/avatar");
        expect(paths).toContain("/api/showcase/events/latest");
    });

    it("GET /users has query parameters from IsSearchQuery", () => {
        const op = (doc.paths as any)["/api/showcase/users"]?.get;
        expect(op).toBeDefined();
        const paramNames = op.parameters.map((p: any) => p.name);
        expect(paramNames).toContain("q");
        expect(paramNames).toContain("limit");
        expect(paramNames).toContain("offset");
    });

    it("GET /users/:id path param is required", () => {
        const op = (doc.paths as any)["/api/showcase/users/{id}"]?.get;
        const idParam = op.parameters.find((p: any) => p.name === "id" && p.in === "path");
        expect(idParam?.required).toBe(true);
    });

    it("POST /users has application/json requestBody", () => {
        const op = (doc.paths as any)["/api/showcase/users"]?.post;
        expect(op.requestBody.content["application/json"]).toBeDefined();
    });

    it("POST /users/avatar uses multipart/form-data", () => {
        const op = (doc.paths as any)["/api/showcase/users/{id}/avatar"]?.post;
        expect(op.requestBody.content["multipart/form-data"]).toBeDefined();
    });

    it("GET /users/:id/avatar has binary response", () => {
        const op = (doc.paths as any)["/api/showcase/users/{id}/avatar"]?.get;
        expect(op.responses["200"].content["*/*"].schema.format).toBe("binary");
    });

    it("getStats 200 response wraps success in JSON envelope", () => {
        const op = (doc.paths as any)["/api/showcase/stats"]?.get;
        const schema = op.responses["200"].content["application/json"].schema;
        expect(schema.properties.success).toBeDefined();
        expect(schema.properties.data).toBeDefined();
    });

    it("discriminated union in getLatestEvent success has oneOf + discriminator", () => {
        const op = (doc.paths as any)["/api/showcase/events/latest"]?.get;
        const dataSchema = op.responses["200"].content["application/json"].schema.properties.data;
        expect(dataSchema.discriminator?.propertyName).toBe("type");
        expect(dataSchema.oneOf).toHaveLength(3);
    });

    it("multiError 404 response merges two 404 errors as oneOf", () => {
        const op = (doc.paths as any)["/api/showcase/multi-error"]?.get;
        const resp404 = op.responses["404"].content["application/json"].schema;
        expect(resp404.oneOf).toHaveLength(2);
    });

    it("operationIds are namespaced as ShowcaseApi_methodName", () => {
        const op = (doc.paths as any)["/api/showcase/users"]?.get;
        expect(op.operationId).toBe("ShowcaseApi_listUsers");
    });

    it("DELETE /users/:id returns 204 (no success schema)", () => {
        const op = (doc.paths as any)["/api/showcase/users/{id}"]?.delete;
        expect(op.responses["204"]).toBeDefined();
    });

    it("branded types carry docs title in schema", () => {
        const op = (doc.paths as any)["/api/showcase/users"]?.post;
        const emailSchema = op.requestBody.content["application/json"].schema.properties.email;
        expect(emailSchema.title).toBe("Email address");
        expect(emailSchema.example).toBe("user@example.com");
    });

    it("password field uses format:password", () => {
        const op = (doc.paths as any)["/api/showcase/users"]?.post;
        const pwSchema = op.requestBody.content["application/json"].schema.properties.password;
        expect(pwSchema.format).toBe("password");
        expect(pwSchema.minLength).toBe(8);
    });
});
