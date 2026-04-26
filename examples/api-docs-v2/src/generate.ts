/**
 * Demo fixture generator.
 *
 * Imports the contracts from each fixture project, builds an
 * `ApiDocsDocument` JSON, writes them under `ui/public/fixtures/`.
 *
 * Run via `npm run generate` from `examples/api-docs-v2/`.
 *
 * The UI loads these JSONs at runtime via fetch — the React app has a
 * top-level dropdown to switch between them.
 */
import {writeFileSync, mkdirSync} from "fs";
import {join, dirname} from "path";
import {fileURLToPath} from "url";
import {buildContractDoc} from "./buildContractDoc";
import type {BuildContractDocOptions} from "./buildContractDoc";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_OUT = join(HERE, "..", "ui", "public", "fixtures");

interface Fixture {
    slug: string;
    options: BuildContractDocOptions;
}

async function loadFixtures(): Promise<Fixture[]> {
    const fixtures: Fixture[] = [];

    // ── grest-test ──────────────────────────────────────────────────────
    // Imported from the in-repo example; demonstrates discriminated unions,
    // file upload/download, complex schemas.
    const grestTest = await loadGrestTest();
    fixtures.push({slug: "grest-test", options: grestTest});

    // ── realestate ──────────────────────────────────────────────────────
    const realestate = await loadRealestate();
    fixtures.push({slug: "realestate", options: realestate});

    // ── kratt ───────────────────────────────────────────────────────────
    const kratt = await loadKratt();
    fixtures.push({slug: "kratt", options: kratt});

    return fixtures;
}

async function loadGrestTest(): Promise<BuildContractDocOptions> {
    // Use the same APIs the showcase server uses so we exercise the rich edge cases.
    const {ShowcaseApi} = await import("../../grest-test/src/api/OpenApiShowcaseApi.js");
    const {ChatApiSchema, NotificationApiSchema} = await import("../../grest-test/src/api/AsyncApiShowcaseApi.js");

    return {
        title: "Grest Test Showcase",
        version: "1.0.0",
        description: "A deliberately rich showcase API used as a snapshot anchor — exercises every structurally interesting schema type, plus a WebSocket showcase.",
        groups: {
            "HTTP Showcase":      {http: [ShowcaseApi]},
            "WebSocket Showcase": {ws:   [ChatApiSchema, NotificationApiSchema]},
        },
    };
}

async function loadRealestate(): Promise<BuildContractDocOptions> {
    const apiDir = "../fixtures/realestate/api";
    // Bulk-import every API module. The realestate package exports the schema
    // as the value matching the file's API name (e.g. ApartmentApi.ts → ApartmentApi).
    const modules = await Promise.all([
        import(`${apiDir}/ApartmentApi.js`),
        import(`${apiDir}/ApartmentFeaturesApi.js`),
        import(`${apiDir}/AuditLogApi.js`),
        import(`${apiDir}/BalanceApi.js`),
        import(`${apiDir}/BankIntegrationApi.js`),
        import(`${apiDir}/BankStatementApi.js`),
        import(`${apiDir}/BookkeepingApi.js`),
        import(`${apiDir}/BookkeepingReportsApi.js`),
        import(`${apiDir}/BuildingApi.js`),
        import(`${apiDir}/ClientApi.js`),
        import(`${apiDir}/CompanyApi.js`),
        import(`${apiDir}/CompanyUserApi.js`),
        import(`${apiDir}/CompanyUserInviteApi.js`),
        import(`${apiDir}/ContractApi.js`),
        import(`${apiDir}/ContractMessageApi.js`),
        import(`${apiDir}/ExpenseApi.js`),
        import(`${apiDir}/ExpenseCompensationApi.js`),
        import(`${apiDir}/ExpenseEmailApi.js`),
        import(`${apiDir}/ExpenseFileApi.js`),
        import(`${apiDir}/InsuranceApi.js`),
        import(`${apiDir}/InvoiceFutureRowApi.js`),
        import(`${apiDir}/InvoicesApi.js`),
        import(`${apiDir}/OverviewApi.js`),
        import(`${apiDir}/OwnerApi.js`),
        import(`${apiDir}/OwnerExpenseApi.js`),
        import(`${apiDir}/PaymentApi.js`),
        import(`${apiDir}/TaskApi.js`),
        import(`${apiDir}/TaskPublicApi.js`),
        import(`${apiDir}/TemplateApi.js`),
        import(`${apiDir}/UploadedFileApi.js`),
    ]);

    // Pluck the API export from each module by convention: the *Api export.
    const allApis: any[] = [];
    for (const mod of modules) {
        for (const [name, value] of Object.entries(mod)) {
            if (name.endsWith("Api") && typeof value === "object" && value !== null && "pathPrefix" in value) {
                allApis.push(value);
            }
        }
    }

    // Group by domain — light heuristic based on prefix patterns.
    const groups: BuildContractDocOptions["groups"] = {
        "Property":      {http: filterByNames(allApis, ["ApartmentApi", "ApartmentFeaturesApi", "BuildingApi", "InsuranceApi"])},
        "Bookkeeping":   {http: filterByNames(allApis, ["BookkeepingApi", "BookkeepingReportsApi", "BalanceApi", "BankIntegrationApi", "BankStatementApi", "InvoicesApi", "InvoiceFutureRowApi", "PaymentApi"])},
        "Expenses":      {http: filterByNames(allApis, ["ExpenseApi", "ExpenseCompensationApi", "ExpenseEmailApi", "ExpenseFileApi"])},
        "Owners & Clients": {http: filterByNames(allApis, ["OwnerApi", "OwnerExpenseApi", "ClientApi"])},
        "Contracts":     {http: filterByNames(allApis, ["ContractApi", "ContractMessageApi", "TemplateApi"])},
        "Tasks":         {http: filterByNames(allApis, ["TaskApi", "TaskPublicApi"])},
        "Company":       {http: filterByNames(allApis, ["CompanyApi", "CompanyUserApi", "CompanyUserInviteApi"])},
        "Files & Audit": {http: filterByNames(allApis, ["UploadedFileApi", "AuditLogApi", "OverviewApi"])},
    };

    return {
        title: "Realestate v2",
        version: "1.0.0",
        description: "Real estate management platform — multi-company, with bank integrations, bookkeeping, expense tracking, and tenant contracts.",
        groups,
    };
}

async function loadKratt(): Promise<BuildContractDocOptions> {
    // Hub — admin/management plane (HTTP)
    const hubModules = await Promise.all([
        import("../fixtures/kratt/hub/AuthApi.js"),
        import("../fixtures/kratt/hub/UserApi.js"),
        import("../fixtures/kratt/hub/OrganizationApi.js"),
        import("../fixtures/kratt/hub/OrgUserApi.js"),
        import("../fixtures/kratt/hub/AgentApi.js"),
        import("../fixtures/kratt/hub/TerminalAccessApi.js"),
        import("../fixtures/kratt/hub/ProjectApi.js"),
        import("../fixtures/kratt/hub/BaseImageApi.js"),
        import("../fixtures/kratt/hub/ProjectImageApi.js"),
        import("../fixtures/kratt/hub/CodeReviewApi.js"),
        import("../fixtures/kratt/hub/HostingResolveApi.js"),
        import("../fixtures/kratt/hub/TaskApi.js"),
    ]);
    const hubApis = pluckApis(hubModules);

    // Relay — agent communication plane (HTTP)
    const relayModules = await Promise.all([
        import("../fixtures/kratt/relay/RelayAgentApi.js"),
        import("../fixtures/kratt/relay/RelayCodeApi.js"),
        import("../fixtures/kratt/relay/RelayServicesApi.js"),
    ]);
    const relayApis = pluckApis(relayModules);

    // Socket — real-time WS
    const socketModules = await Promise.all([
        import("../fixtures/kratt/socket/SocketApi.js"),
        import("../fixtures/kratt/socket/NotifyApi.js"),
    ]);
    const wsApis: any[] = [];
    const httpApisFromSocket: any[] = [];
    for (const mod of socketModules) {
        for (const [name, value] of Object.entries(mod)) {
            if (name.endsWith("Api") || name.endsWith("ApiSchema") || name.endsWith("Schema")) {
                if (typeof value === "object" && value !== null) {
                    if ("contract" in value && "path" in value && !("pathPrefix" in value)) {
                        wsApis.push(value);
                    } else if ("pathPrefix" in value) {
                        httpApisFromSocket.push(value);
                    }
                }
            }
        }
    }

    return {
        title: "Kratt",
        version: "0.0.1",
        description: "Multi-agent dev platform — hub for management, relay for agent comms, socket for real-time events.",
        groups: {
            "Hub":    {http: hubApis,    description: "Management plane — auth, organizations, projects, tasks, base images."},
            "Relay":  {http: relayApis,  description: "Agent communication plane."},
            ...(httpApisFromSocket.length > 0 ? {"Socket HTTP": {http: httpApisFromSocket}} : {}),
            ...(wsApis.length > 0 ? {"Socket": {ws: wsApis, description: "Real-time WebSocket events."}} : {}),
        },
    };
}

function pluckApis(modules: any[]): any[] {
    const out: any[] = [];
    for (const mod of modules) {
        for (const [name, value] of Object.entries(mod)) {
            if (name.endsWith("Api") && typeof value === "object" && value !== null && "pathPrefix" in value) {
                out.push(value);
            }
        }
    }
    return out;
}

function filterByNames(apis: any[], names: string[]): any[] {
    return apis.filter(a => names.includes(a.name));
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
    console.log("Generating api-docs-v2 fixtures…\n");
    mkdirSync(FIXTURES_OUT, {recursive: true});

    const fixtures = await loadFixtures();

    const index: Array<{slug: string; title: string; description?: string; groupCount: number; methodCount: number}> = [];

    for (const fixture of fixtures) {
        try {
            const doc = buildContractDoc(fixture.options);
            const file = join(FIXTURES_OUT, `${fixture.slug}.json`);
            writeFileSync(file, JSON.stringify(doc, null, 2));

            const methodCount = doc.groups.reduce((sum, g) =>
                sum + g.contracts.reduce((s, c) => s + c.methods.length, 0), 0);
            console.log(`  ${fixture.slug.padEnd(15)} ${doc.groups.length} groups, ${methodCount} methods → ${file}`);
            index.push({
                slug: fixture.slug,
                title: doc.service.name,
                ...(doc.service.description ? {description: doc.service.description} : {}),
                groupCount: doc.groups.length,
                methodCount,
            });
        } catch (err) {
            console.error(`  ${fixture.slug}: FAILED — ${(err as Error).message}`);
            console.error((err as Error).stack);
        }
    }

    writeFileSync(join(FIXTURES_OUT, "index.json"), JSON.stringify(index, null, 2));
    console.log("\nDone.");
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
