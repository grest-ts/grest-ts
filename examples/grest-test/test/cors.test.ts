import {GGTest} from "@grest-ts/testkit";
import {MainRuntime} from "../src/main";
import {GG_DISCOVERY} from "@grest-ts/discovery";
import {MiddlewareTestApi} from "../src/api/MiddlewareTestApi";
import {FileUploadTestApi} from "../src/api/FileUploadTestApi";

describe("CORS auto-discovery", () => {

    GGTest.startInline(MainRuntime);

    async function fetchWithOrigin(apiName: string, path: string, method = 'GET') {
        const baseUrl = await GG_DISCOVERY.get().discoverApi(apiName);
        return fetch(`${baseUrl}/${path}`, {
            method,
            headers: {'Origin': 'http://test.example.com'}
        });
    }

    test("Access-Control-Allow-Headers includes headers from middleware and codecs", async () => {
        const response = await fetchWithOrigin(MiddlewareTestApi.name, "api/middleware-test/language");
        const allowHeaders = response.headers.get('Access-Control-Allow-Headers')!;

        expect(allowHeaders).toBeDefined();
        expect(allowHeaders).toContain('Content-Type');
        expect(allowHeaders).toContain('accept-language');
        expect(allowHeaders).toContain('x-client-version');
        expect(allowHeaders).toContain('x-client-platform');
        expect(allowHeaders).toContain('x-feature-flags');
    });

    test("Access-Control-Allow-Headers does not contain hardcoded application-specific headers", async () => {
        const response = await fetchWithOrigin(MiddlewareTestApi.name, "api/middleware-test/language");
        const allowHeaders = response.headers.get('Access-Control-Allow-Headers')!;

        expect(allowHeaders).not.toContain('x-org-token');
        expect(allowHeaders).not.toContain('x-company-auth');
    });

    test("Access-Control-Expose-Headers includes responseHeaders from file download codec", async () => {
        const response = await fetchWithOrigin(FileUploadTestApi.name, "api/file-upload-test/download", 'POST');
        const exposeHeaders = response.headers.get('Access-Control-Expose-Headers')!;

        expect(exposeHeaders).toBeDefined();
        expect(exposeHeaders).toContain('Content-Disposition');
    });

    test("OPTIONS preflight returns auto-discovered headers", async () => {
        const response = await fetchWithOrigin(MiddlewareTestApi.name, "api/middleware-test/language", 'OPTIONS');

        expect(response.status).toBe(204);

        const allowHeaders = response.headers.get('Access-Control-Allow-Headers')!;
        expect(allowHeaders).toContain('accept-language');
        expect(allowHeaders).toContain('x-client-version');
    });

    test("CORS headers are absent when request has no Origin", async () => {
        const baseUrl = await GG_DISCOVERY.get().discoverApi(MiddlewareTestApi.name);
        const response = await fetch(`${baseUrl}/api/middleware-test/language`);

        expect(response.headers.get('Access-Control-Allow-Headers')).toBeNull();
        expect(response.headers.get('Access-Control-Expose-Headers')).toBeNull();
    });
});
