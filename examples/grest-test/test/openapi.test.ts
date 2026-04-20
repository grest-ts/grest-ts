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

    it("discriminated union in getLatestEvent — data is $ref to Event component", () => {
        const op = (doc.paths as any)["/api/showcase/events/latest"]?.get;
        const dataField = op.responses["200"].content["application/json"].schema.properties.data;
        // IsEvent has title "Event" → extracted to components/schemas/Event
        expect(dataField.$ref).toBe("#/components/schemas/Event");
    });

    it("Event component has oneOf + discriminator", () => {
        const eventSchema = (doc as any).components?.schemas?.["Event"];
        expect(eventSchema).toBeDefined();
        expect(eventSchema.discriminator?.propertyName).toBe("type");
        expect(eventSchema.oneOf).toHaveLength(3);
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

    it("named schemas are extracted to components/schemas", () => {
        const schemas = (doc as any).components?.schemas ?? {};
        expect(schemas["UserProfile"]).toBeDefined();
        expect(schemas["Event"]).toBeDefined();
        // Branded custom types with titles are also extracted
        expect(schemas["EmailAddress"]).toBeDefined();
        expect(schemas["URL"]).toBeDefined();   // title is "URL" (all caps)
        expect(schemas["Date"]).toBeDefined();
        expect(schemas["IPAddress"]).toBeDefined(); // title is "IP address"
    });

    it("EmailAddress component carries format:email", () => {
        const emailSchema = (doc as any).components?.schemas?.["EmailAddress"];
        expect(emailSchema?.format).toBe("email");
        expect(emailSchema?.title).toBe("Email address");
        expect(emailSchema?.example).toBe("user@example.com");
    });

    it("URL component carries format:uri", () => {
        const urlSchema = (doc as any).components?.schemas?.["URL"];
        expect(urlSchema?.format).toBe("uri");
    });

    it("Date component carries format:date", () => {
        const dateSchema = (doc as any).components?.schemas?.["Date"];
        expect(dateSchema?.format).toBe("date");
    });

    it("IPAddress component carries format:ip", () => {
        const ipSchema = (doc as any).components?.schemas?.["IPAddress"];
        expect(ipSchema?.format).toBe("ip");
    });

    it("password field uses format:password — resolved from CreateUserRequest component", () => {
        const components = (doc as any).components?.schemas ?? {};
        // IsCreateUserRequest has title → extracted
        const createReq = components["CreateUserRequest"];
        const pwSchema = createReq?.properties?.password;
        expect(pwSchema?.format).toBe("password");
        expect(pwSchema?.minLength).toBe(8);
    });

    it("UserProfile email field is a $ref to EmailAddress component", () => {
        const userProfile = (doc as any).components?.schemas?.["UserProfile"];
        const emailRef = userProfile?.properties?.email;
        expect(emailRef?.$ref).toBe("#/components/schemas/EmailAddress");
    });
});
