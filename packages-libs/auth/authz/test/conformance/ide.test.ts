import {describe, expect, test} from "vitest"
import {GGAuthz, GGAuthzMemoryResolver, type GGAuthzModel, type GGAuthzPolicies, GGAuthzRn, type GGAuthzSubject} from "../../src/index-node"

const org = "rn:ide:org:acme:org/acme"
const catalog = "rn:ide:ext:acme:catalog/main"
const ext = (publisher: string, id: string) => `rn:ide:ext:acme:publisher/${publisher}/extension/${id}`
const ws = (id: string) => `rn:ide:ws:acme:workspace/${id}`
const installed = (w: string, id: string) => `${ws(w)}/extension/${id}`
const profile = (id: string) => `rn:ide:profile:acme:profile/${id}`
const site = (id: string) => `rn:ide:sites:acme:site/${id}`
const store = (user: string) => `rn:ide:secrets:acme:store/${user}`
const secret = (user: string, id: string) => `${store(user)}/secret/${id}`

const model: GGAuthzModel = {
    partition: "ide",
    actions: [
        {name: "ext:Install", resourceTypes: ["ext:extension"]},
        {name: "ext:Activate", resourceTypes: ["ws:extension"]},
        ...["ws:Open", "ws:EditFiles", "ws:RunTerminal"].map(name => ({name, resourceTypes: ["ws:workspace"]})),
        ...["profile:Read", "profile:Apply", "profile:Write", "profile:WriteSetting"].map(name => ({name, resourceTypes: ["profile:profile"]})),
        ...["sites:Use", "sites:Deploy"].map(name => ({name, resourceTypes: ["sites:site"]})),
        ...["secrets:Read", "secrets:Write"].map(name => ({name, resourceTypes: ["secrets:secret"]})),
    ],
    roles: [
        {name: "developer", actions: ["ext:*", "ws:*"]},
        {name: "profile-member", actions: ["profile:Read", "profile:Apply"]},
        {name: "profile-editor", actions: ["profile:Write", "profile:WriteSetting"], includes: ["profile-member"]},
        {name: "site-user", actions: ["sites:Use"]},
        {name: "site-deployer", actions: ["sites:Deploy"], includes: ["site-user"]},
        {name: "secret-owner", actions: ["secrets:*"]},
        {name: "admin", actions: ["ext:*", "ws:*", "profile:*", "sites:*", "secrets:*"]},
    ],
    workloadTypes: ["agent", "plugin"],
}

const parents: Record<string, string> = {
    [catalog]: org,
    [profile("org")]: org, [profile("team-web")]: org, [profile("ann")]: org, [profile("ben")]: org,
    [site("staging")]: org, [site("prod")]: org, [site("docs")]: org,
    [store("ann")]: org, [secret("ann", "linter-token")]: store("ann"), [secret("ann", "deploy-token")]: store("ann"),
}
for (const publisher of ["trusted", "other"]) parents[`rn:ide:ext:acme:publisher/${publisher}`] = catalog
for (const [publisher, id] of [["trusted", "linter"], ["trusted", "theme"], ["trusted", "deployer"], ["trusted", "compromised"], ["other", "fmt"], ["other", "miner"]]) {
    parents[ext(publisher!, id!)] = `rn:ide:ext:acme:publisher/${publisher}`
}
for (const w of ["w1", "w2"]) {
    parents[ws(w)] = org
    for (const id of ["linter", "theme"]) parents[installed(w, id)] = ws(w)
}

const resolver = new GGAuthzMemoryResolver({
    parents,
    groups: {
        "user:ann": ["group:devs", "group:web-team"],
        "user:lead": ["group:devs", "group:web-team"],
        "user:dan": ["group:devs", "group:contractors"],
        "user:root": ["group:admins"],
    },
    attributes: {
        [profile("ann")]: {owner: "user:ann"},
        [profile("ben")]: {owner: "user:ben"},
        [installed("w1", "theme")]: {untrustedSupport: true},
        [installed("w2", "theme")]: {untrustedSupport: true},
        [secret("ann", "linter-token")]: {extension: "plugin:linter"},
        [secret("ann", "deploy-token")]: {extension: "plugin:deployer"},
    },
})

const policies: GGAuthzPolicies = {
    bindings: [
        {principal: "group:devs", role: "developer", on: org},
        {principal: "group:devs", role: "profile-member", on: profile("org")},
        {principal: "group:web-team", role: "profile-member", on: profile("team-web")},
        {principal: "user:lead", role: "profile-editor", on: profile("team-web")},
        {principal: "group:web-team", role: "site-user", on: site("staging")},
        {principal: "group:web-team", role: "site-user", on: site("prod")},
        {principal: "user:lead", role: "site-deployer", on: site("staging")},
        {principal: "user:ann", role: "secret-owner", on: store("ann")},
        {principal: "group:admins", role: "admin", on: org},
    ],
    resourcePolicies: [
        {
            on: org,
            statements: [
                {sid: "own-profile", effect: "allow", principals: ["user:*"], actions: ["profile:*"], conditions: [{key: "resource.owner", op: "eq", ref: "principal.key"}]},
                {
                    sid: "restricted-mode", effect: "deny", principals: ["everyone"], actions: ["ext:Activate"],
                    conditions: [{key: "context.trusted", op: "ne", value: true}, {key: "resource.untrustedSupport", op: "ne", value: true}],
                },
            ],
            approvals: [
                {actions: ["ws:RunTerminal"], level: "ask"},
                {actions: ["sites:Use"], level: "ask-once"},
                {actions: ["secrets:Write"], level: "humans-only"},
            ],
        },
        {on: ws("w2"), statements: [{sid: "linter-off-here", effect: "deny", principals: ["everyone"], actions: ["ext:Activate"], resources: [`=${installed("w2", "linter")}`]}]},
    ],
    guardrails: [
        {id: "extension-allowlist", on: catalog, ceiling: [{actions: ["ext:*"], resources: ["rn:ide:ext:acme:publisher/trusted/*", `=${ext("other", "fmt")}`]}]},
        {id: "extension-blocklist", on: catalog, deny: [{actions: ["ext:*"], resources: [`=${ext("trusted", "compromised")}`]}]},
        {id: "managed-settings", on: org, deny: [{actions: ["profile:WriteSetting"], conditions: [{key: "context.setting", op: "in", value: ["telemetry.level", "update.mode"]}]}]},
        {id: "contractors-no-prod", on: site("prod"), principals: ["group:contractors"], deny: [{actions: ["sites:*"]}]},
    ],
    boundaries: [
        {id: "plugins", principals: ["plugin:*"], allow: [{actions: ["sites:Use", "sites:Deploy", "ws:EditFiles"]}, {actions: ["secrets:Read"], conditions: [{key: "resource.extension", op: "eq", ref: "actor.key"}]}]},
        {id: "linter", principals: ["plugin:linter"], allow: [{actions: ["ws:EditFiles", "secrets:Read"]}]},
        {id: "assistant", principals: ["agent:*"], allow: [{actions: ["ws:*", "profile:Read", "sites:Use", "secrets:*"]}]},
    ],
}
const authz = new GGAuthz({model, policies, resolver})

const user = (id: string): GGAuthzSubject => ({type: "user", id})
const forUser = (actor: string, id: string, properties: NonNullable<GGAuthzSubject["properties"]> = {}): GGAuthzSubject =>
    ({type: actor.split(":")[0]!, id: actor.split(":")[1]!, properties: {onBehalfOf: user(id), ...properties}})
const check = (subject: GGAuthzSubject, action: string, rn: string, context?: Record<string, unknown>) =>
    authz.evaluate({subject, action: {name: action}, resource: {type: GGAuthzRn.type(rn)!, id: rn}, context})
const may = async (...args: Parameters<typeof check>) => (await check(...args)).decision

describe("ide: extension marketplace", () => {
    test("the org allowlist is a ceiling on the catalog: trusted publishers and named extensions only", async () => {
        expect(await may(user("ann"), "ext:Install", ext("trusted", "linter"))).toBe(true)
        expect(await may(user("ann"), "ext:Install", ext("other", "fmt"))).toBe(true)
        const d = await check(user("ann"), "ext:Install", ext("other", "miner"))
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "guardrail", kind: "ceiling-failed", id: "extension-allowlist"})])
    })

    test("a guardrail on the catalog limits only extension actions", async () => {
        expect(await may(user("ann"), "ws:Open", ws("w1"))).toBe(true)
    })

    test("a blocklisted extension is out even for admins", async () => {
        expect(await may(user("root"), "ext:Install", ext("trusted", "compromised"))).toBe(false)
        expect(await may(user("root"), "ext:Install", ext("trusted", "theme"))).toBe(true)
    })
})

describe("ide: activation in a workspace", () => {
    test("restricted mode: in an untrusted workspace only extensions that declare support activate", async () => {
        expect(await may(user("ann"), "ext:Activate", installed("w1", "linter"), {trusted: true})).toBe(true)
        expect(await may(user("ann"), "ext:Activate", installed("w1", "linter"), {trusted: false})).toBe(false)
        expect(await may(user("ann"), "ext:Activate", installed("w1", "theme"), {trusted: false})).toBe(true)
    })

    test("trust not stated counts as untrusted", async () => {
        expect(await may(user("ann"), "ext:Activate", installed("w1", "linter"))).toBe(false)
        expect(await may(user("ann"), "ext:Activate", installed("w1", "theme"))).toBe(true)
    })

    test("an extension disabled in one workspace stays enabled in the others", async () => {
        expect(await may(user("ann"), "ext:Activate", installed("w2", "linter"), {trusted: true})).toBe(false)
    })
})

describe("ide: profiles and managed settings", () => {
    test("a user owns their own profile and nobody else's", async () => {
        expect(await may(user("ann"), "profile:WriteSetting", profile("ann"), {setting: "editor.fontSize"})).toBe(true)
        expect(await may(user("ann"), "profile:Read", profile("ben"))).toBe(false)
    })

    test("team profile: members apply it, the lead edits it", async () => {
        expect(await may(user("ann"), "profile:Apply", profile("team-web"))).toBe(true)
        expect(await may(user("ann"), "profile:Write", profile("team-web"))).toBe(false)
        expect(await may(user("lead"), "profile:Write", profile("team-web"))).toBe(true)
        expect(await may(user("dan"), "profile:Apply", profile("team-web"))).toBe(false)
        expect(await may(user("dan"), "profile:Apply", profile("org"))).toBe(true)
    })

    test("managed settings can't be changed in any profile, admins included", async () => {
        expect(await may(user("ann"), "profile:WriteSetting", profile("ann"), {setting: "telemetry.level"})).toBe(false)
        expect(await may(user("root"), "profile:WriteSetting", profile("org"), {setting: "update.mode"})).toBe(false)
        expect(await may(user("root"), "profile:WriteSetting", profile("org"), {setting: "editor.tabSize"})).toBe(true)
    })

    test("a setting write without the setting name is refused", async () => {
        expect(await may(user("ann"), "profile:WriteSetting", profile("ann"))).toBe(false)
    })
})

describe("ide: org-provided resources and the plugins that use them", () => {
    test("access to a site is a binding; a plugin acting for the user inherits only that", async () => {
        expect(await may(forUser("plugin:deployer", "ann"), "sites:Use", site("staging"))).toBe(true)
        expect(await may(forUser("plugin:deployer", "ann"), "sites:Use", site("docs"))).toBe(false)
        expect(await may(forUser("plugin:deployer", "dan"), "sites:Use", site("staging"))).toBe(false)
    })

    test("first use of an account by a plugin asks the user once", async () => {
        const d = await check(forUser("plugin:deployer", "ann"), "sites:Use", site("staging"))
        expect(d.context).toMatchObject({outcome: "allow-with-approval", approval: "ask-once"})
    })

    test("a plugin activates only when the org has provided something it can use", async () => {
        const sites = [site("staging"), site("prod"), site("docs")]
        const usable = async (id: string) => GGAuthz.applyPlan(
            await authz.listAllowed({subject: forUser("plugin:deployer", id), action: {name: "sites:Use"}, resource: {type: "sites:site"}}),
            sites, {resolver},
        )
        expect(await usable("ann")).toEqual([site("staging"), site("prod")])
        expect(await usable("dan")).toEqual([])
    })

    test("a plugin's own boundary narrows the type-wide one", async () => {
        expect(await may(forUser("plugin:linter", "ann"), "sites:Use", site("staging"))).toBe(false)
        expect(await may(forUser("plugin:linter", "ann"), "ws:EditFiles", ws("w1"))).toBe(true)
    })

    test("an unknown plugin is still capped by the type-wide boundary", async () => {
        expect(await may(forUser("plugin:unknown", "ann"), "ws:RunTerminal", ws("w1"))).toBe(false)
    })

    test("each plugin reads only its own secrets from the user's store", async () => {
        expect(await may(forUser("plugin:linter", "ann"), "secrets:Read", secret("ann", "linter-token"))).toBe(true)
        expect(await may(forUser("plugin:linter", "ann"), "secrets:Read", secret("ann", "deploy-token"))).toBe(false)
        expect(await may(forUser("plugin:deployer", "ann"), "secrets:Read", secret("ann", "deploy-token"))).toBe(true)
    })

    test("the manifest's declared permissions are a per-request restriction", async () => {
        const declared = forUser("plugin:deployer", "lead", {restrictions: [{actions: ["sites:Use"]}]})
        expect(await may(declared, "sites:Use", site("staging"))).toBe(true)
        const d = await check(declared, "sites:Deploy", site("staging"))
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "restriction"})])
        expect(await may(forUser("plugin:deployer", "lead"), "sites:Deploy", site("staging"))).toBe(true)
    })

    test("guardrails on the resource hold for plugins too", async () => {
        expect(await may(forUser("plugin:deployer", "ann"), "sites:Use", site("prod"))).toBe(true)
        const contractor = new GGAuthz({model, policies: {...policies, bindings: [...policies.bindings!, {principal: "user:dan", role: "site-user", on: site("prod")}]}, resolver})
        expect((await contractor.evaluate({subject: forUser("plugin:deployer", "dan"), action: {name: "sites:Use"}, resource: {type: "sites:site", id: site("prod")}})).decision).toBe(false)
    })
})

describe("ide: the AI assistant", () => {
    const assistant = forUser("agent:assistant", "ann")

    test("terminal commands need the user's confirmation", async () => {
        expect((await check(assistant, "ws:RunTerminal", ws("w1"))).context).toMatchObject({outcome: "allow-with-approval", approval: "ask"})
        expect((await check(user("ann"), "ws:RunTerminal", ws("w1"))).context.approval).toBeUndefined()
    })

    test("it can't install extensions or write secrets", async () => {
        expect(await may(assistant, "ext:Install", ext("trusted", "linter"))).toBe(false)
        expect(await may(assistant, "secrets:Write", secret("ann", "linter-token"))).toBe(false)
        expect(await may(assistant, "secrets:Read", secret("ann", "linter-token"))).toBe(true)
    })

    test("a plugin called by the assistant is capped by both", async () => {
        const chain = forUser("plugin:deployer", "lead", {via: [{type: "agent", id: "assistant"}]})
        expect(await may(chain, "sites:Use", site("staging"))).toBe(true)
        expect(await may(chain, "sites:Deploy", site("staging"))).toBe(false)
    })
})
