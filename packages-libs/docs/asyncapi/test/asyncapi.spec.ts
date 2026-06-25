import {describe, it, expect} from "vitest";
import {toAsyncApi} from "../src/toAsyncApi";

// Import the grest-test WebSocket APIs as real test fixtures
import {ConfigTestSocketApi} from "../../../../examples/grest-test/src/api/ConfigTestSocketApi";

import {GGWebSocketSchema} from "@grest-ts/websocket";
import type {GGSchema} from "@grest-ts/schema";
import {IsString, IsObject, IsNumber, SERVER_ERROR, VALIDATION_ERROR, IsBearerToken, GG_NO_PERMISSIONS, GGDuplexContract } from "@grest-ts/schema";
import type {GGTransportMiddleware} from "@grest-ts/context";

// ---------------------------------------------------------------------------
// A rich WebSocket showcase contract for snapshot testing
// ---------------------------------------------------------------------------

const ChatContract = new GGDuplexContract("ChatApi", {
    connect: {},
    clientToServer: {
        sendMessage: {
            input: IsObject({
                text: IsString.nonEmpty.docs({description: "Message text"}),
                roomId: IsString.nonEmpty
            }),
            success: IsObject({messageId: IsString.nonEmpty, timestamp: IsNumber}),
            errors: [VALIDATION_ERROR, SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        },
        joinRoom: {
            input: IsObject({roomId: IsString.nonEmpty}),
            // no success — fire-and-forget
            permission: GG_NO_PERMISSIONS
        }
    },
    serverToClient: {
        onMessage: {
            input: IsObject({
                messageId: IsString.nonEmpty,
                text: IsString.nonEmpty,
                userId: IsString.nonEmpty,
                timestamp: IsNumber
            }).docs({title: "Chat message", description: "A message pushed to the client"}),
            permission: GG_NO_PERMISSIONS
        },
        onUserJoined: {
            input: IsObject({userId: IsString.nonEmpty, roomId: IsString.nonEmpty}),
            permission: GG_NO_PERMISSIONS
        }
    }
});

const ChatAuthMiddleware: GGTransportMiddleware = {
    // IsBearerToken's branded value type is invariant-incompatible with the header element
    // type, but the doc generator only reads its docs (format: "bearer"), so the brand is moot.
    headers: {
        "authorization": IsBearerToken.docs({description: "JWT access token for chat auth"}) as unknown as GGSchema<string | undefined>
    }
};

const ChatApi = new GGWebSocketSchema({
    contract: ChatContract,
    path: "ws/chat",
    use: [ChatAuthMiddleware],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("toAsyncApi", () => {

    const doc = toAsyncApi([ChatApi, ConfigTestSocketApi], {
        title: "Showcase AsyncAPI",
        version: "1.0.0",
        description: "WebSocket API documentation"
    });

    it("produces AsyncAPI 3.0.0 document", () => {
        expect(doc.asyncapi).toBe("3.0.0");
    });

    it("sets info correctly", () => {
        expect(doc.info.title).toBe("Showcase AsyncAPI");
        expect(doc.info.version).toBe("1.0.0");
    });

    it("has channels for each schema", () => {
        expect(doc.channels["ChatApi"]).toBeDefined();
        expect(doc.channels["ConfigTestSocketApi"]).toBeDefined();
    });

    it("channel address matches schema path", () => {
        expect(doc.channels["ChatApi"].address).toBe("/ws/chat");
    });

    describe("clientToServer request/response", () => {
        it("sendMessage creates request and response messages", () => {
            const ch = doc.channels["ChatApi"];
            expect(ch.messages?.["ChatApi_sendMessage_request"]).toBeDefined();
            expect(ch.messages?.["ChatApi_sendMessage_response"]).toBeDefined();
        });

        it("sendMessage operation has send action", () => {
            const op = doc.operations["ChatApi_send_sendMessage"];
            expect(op).toBeDefined();
            expect(op.action).toBe("send");
        });

        it("sendMessage operation has reply", () => {
            const op = doc.operations["ChatApi_send_sendMessage"];
            expect(op.reply).toBeDefined();
        });
    });

    describe("clientToServer fire-and-forget", () => {
        it("joinRoom creates single message (no response)", () => {
            const ch = doc.channels["ChatApi"];
            expect(ch.messages?.["ChatApi_joinRoom"]).toBeDefined();
            expect(ch.messages?.["ChatApi_joinRoom_response"]).toBeUndefined();
        });

        it("joinRoom operation has no reply", () => {
            const op = doc.operations["ChatApi_send_joinRoom"];
            expect(op.reply).toBeUndefined();
        });
    });

    describe("serverToClient push", () => {
        it("onMessage creates receive operation", () => {
            const op = doc.operations["ChatApi_receive_onMessage"];
            expect(op).toBeDefined();
            expect(op.action).toBe("receive");
        });
    });

    describe("security schemes from bearer headers", () => {
        it("BearerToken security scheme emitted for bearer middleware", () => {
            const schemes = doc.components?.securitySchemes ?? {};
            expect(schemes["BearerToken"]).toBeDefined();
            expect((schemes["BearerToken"] as any).type).toBe("http");
        });

        it("channel binding includes handshake headers for non-bearer headers", () => {
            // ChatApi has only bearer — should have no plain header in binding
            const binding = doc.channels["ChatApi"].bindings?.ws;
            // bearer headers are emitted as security, not as binding headers
            if (binding?.headers) {
                expect(Object.keys(binding.headers.properties ?? {})).not.toContain("authorization");
            }
        });

        it("operation security follows contract permission, not middleware", () => {
            // ChatApi.sendMessage declares permission: GG_NO_PERMISSIONS, which is
            // the source of truth for the operation's security. Middleware-derived
            // BearerToken is registered as a scheme (clients may still send the
            // header) but the operation no longer claims it as required.
            const op = doc.operations["ChatApi_send_sendMessage"];
            expect(op.security).toBeUndefined();
        });
    });

    describe("schema $ref extraction", () => {
        it("named schema (onMessage input with title) extracted to components", () => {
            const schemas = doc.components?.schemas ?? {};
            expect(schemas["ChatMessage"]).toBeDefined();
        });

        it("message payload uses $ref for named schema", () => {
            const msg = doc.channels["ChatApi"].messages?.["ChatApi_onMessage"] as any;
            expect(msg?.payload?.$ref).toBe("#/components/schemas/ChatMessage");
        });
    });

    describe("ConfigTestSocketApi", () => {
        it("has getWatchedValue with request/response", () => {
            const ch = doc.channels["ConfigTestSocketApi"];
            expect(ch.messages?.["ConfigTestSocketApi_getWatchedValue_request"]).toBeDefined();
            expect(ch.messages?.["ConfigTestSocketApi_getWatchedValue_response"]).toBeDefined();
        });

        it("has configChanged server push", () => {
            const op = doc.operations["ConfigTestSocketApi_receive_configChanged"];
            expect(op).toBeDefined();
            expect(op.action).toBe("receive");
        });
    });

    it("matches snapshot", () => {
        expect(doc).toMatchSnapshot();
    });
});
