import {describe, expect, test} from "vitest"
import {GGAuthz, type GGAuthzFacts, GGAuthzMemoryResolver, type GGAuthzModel, type GGAuthzPolicies, GGAuthzRn, type GGAuthzSubject} from "../../src/index-node"
import {filterAsync} from "../util"

const r = (service: string, path: string) => `rn:fga:${service}:t:${path}`

const model: GGAuthzModel = {
    partition: "fga",
    actions: [
        {name: "zdoc:Read", resourceTypes: ["zdoc:doc", "zdoc:folder"]},
        {name: "zdoc:Write", resourceTypes: ["zdoc:doc"]},
        {name: "zdoc:ChangeOwner", resourceTypes: ["zdoc:doc"]},
        {name: "drive:View", resourceTypes: ["drive:doc"]},
        {name: "drive:Comment", resourceTypes: ["drive:doc"]},
        {name: "drive:Write", resourceTypes: ["drive:doc"]},
        {name: "drive:Own", resourceTypes: ["drive:doc"]},
        {name: "gh:Read", resourceTypes: ["gh:repo"]},
        {name: "gh:Triage", resourceTypes: ["gh:repo"]},
        {name: "gh:Write", resourceTypes: ["gh:repo"]},
        {name: "gh:Maintain", resourceTypes: ["gh:repo"]},
        {name: "gh:Admin", resourceTypes: ["gh:repo"]},
        {name: "doc:View", resourceTypes: ["doc:document", "doc:folder"]},
        {name: "doc:Edit", resourceTypes: ["doc:document", "doc:folder"]},
        {name: "doc:Delete", resourceTypes: ["doc:document"]},
        {name: "trip:ViewBookings", resourceTypes: ["trip:trip"]},
        {name: "trip:AddBooking", resourceTypes: ["trip:trip"]},
        {name: "asset:View", resourceTypes: ["asset:category"]},
        {name: "asset:Edit", resourceTypes: ["asset:category"]},
        {name: "bank:View", resourceTypes: ["bank:account", "bank:transaction"]},
    ],
    roles: [
        {name: "zdoc-owner", actions: ["zdoc:ChangeOwner", "zdoc:Write", "zdoc:Read"]},
        {name: "zdoc-editor", actions: ["zdoc:Write", "zdoc:Read"]},
        {name: "zdoc-viewer", actions: ["zdoc:Read"]},
        {name: "drive-owner", actions: ["drive:Own", "drive:Write", "drive:Comment", "drive:View"]},
        {name: "drive-writer", actions: ["drive:Write", "drive:Comment", "drive:View"]},
        {name: "drive-commenter", actions: ["drive:Comment", "drive:View"]},
        {name: "drive-viewer", actions: ["drive:View"]},
        {name: "gh-admin", actions: ["gh:Admin", "gh:Maintain", "gh:Write", "gh:Triage", "gh:Read"]},
        {name: "gh-writer", actions: ["gh:Write", "gh:Triage", "gh:Read"]},
        {name: "gh-reader", actions: ["gh:Read"]},
        {name: "doc-viewer", actions: ["doc:View"]},
        {name: "doc-editor", actions: ["doc:Edit"]},
        {name: "doc-writer", actions: ["doc:Edit", "doc:Delete"]},
        {name: "trip-owner", actions: ["trip:AddBooking", "trip:ViewBookings"]},
        {name: "trip-viewer", actions: ["trip:ViewBookings"]},
        {name: "asset-editor", actions: ["asset:Edit", "asset:View"]},
        {name: "asset-viewer", actions: ["asset:View"]},
        {name: "bank-customer", actions: ["bank:View"]},
        {name: "bank-account-manager", actions: ["bank:View"]},
    ],
}

const rn = {
    readme: r("zdoc", "doc/readme"),
    folderA: r("zdoc", "folder/A"),
    budget: r("drive", "doc/2021-budget"),
    planning: r("drive", "doc/2021-planning"),
    roadmap: r("drive", "doc/2021-public-roadmap"),
    contoso: r("gh", "org/contoso"),
    tooling: r("gh", "repo/contoso-tooling"),
    meetingNotes: r("doc", "document/meeting_notes.doc"),
    notes: r("doc", "folder/notes"),
    planningDoc: r("doc", "document/planning"),
    abc: r("doc", "org/ABC"),
    xyz: r("doc", "org/XYZ"),
    abcPlanning: r("doc", "document/abc-planning"),
    psa: r("doc", "document/company-psa.doc"),
    doc1: r("doc", "document/1"),
    europe: r("trip", "trip/Europe"),
    logos: r("asset", "category/logos"),
    westSide: r("bank", "branch/west-side"),
    eastSide: r("bank", "branch/east-side"),
    account: r("bank", "account/caroline-checking"),
    txA: r("bank", "account/caroline-checking/transaction/A"),
}

const policies: GGAuthzPolicies = {
    bindings: [
        // Zanzibar paper §2.1: doc:readme#owner@10, doc:readme#editor@group:eng#member, doc:readme#parent@folder:A
        {principal: "user:10", role: "zdoc-owner", on: rn.readme},
        {principal: "group:eng", role: "zdoc-editor", on: rn.readme},
        {principal: "user:12", role: "zdoc-viewer", on: rn.folderA},
        {principal: "user:beth", role: "drive-commenter", on: rn.budget},
        {principal: "user:anne", role: "drive-owner", on: rn.budget},
        {principal: "group:xyz", role: "drive-viewer", on: rn.budget},
        {principal: "user:diane", role: "drive-viewer", on: rn.planning},
        {principal: "user:anne", role: "drive-owner", on: rn.roadmap},
        {principal: "group:xyz", role: "drive-commenter", on: rn.roadmap},
        {principal: "user:*", role: "drive-viewer", on: rn.roadmap},
        {principal: "user:anne", role: "gh-reader", on: rn.tooling},
        {principal: "user:beth", role: "gh-writer", on: rn.tooling},
        {principal: "team:contoso-engineering", role: "gh-admin", on: rn.tooling},
        {principal: "group:contoso-members", role: "gh-admin", on: rn.contoso},
        {principal: "team:writers", role: "doc-editor", on: rn.meetingNotes},
        {principal: "user:bob", role: "doc-editor", on: rn.notes},
        {principal: "team:product", role: "doc-editor", on: rn.planningDoc},
        {principal: "user:becky", role: "doc-writer", on: rn.abcPlanning},
        {principal: "user:carl", role: "doc-writer", on: rn.abcPlanning},
        {principal: "user:*", role: "doc-viewer", on: rn.psa},
        {principal: "user:anne", role: "doc-viewer", on: rn.doc1, when: ["nonExpiredGrant"]},
        {principal: "user:bob", role: "trip-viewer", on: rn.europe},
        {principal: "user:alice", role: "trip-owner", on: rn.europe},
        {principal: "role:media-manager", role: "asset-editor", on: rn.logos},
        {principal: "role:media-viewer", role: "asset-viewer", on: rn.logos},
        {principal: "user:caroline", role: "bank-customer", on: rn.account},
        {principal: "user:anne", role: "bank-account-manager", on: rn.westSide, when: ["approvedContext"]},
        {principal: "user:mary", role: "bank-account-manager", on: rn.eastSide, when: ["approvedContext"]},
    ],
    resourcePolicies: [
        {on: rn.planningDoc, statements: [{sid: "blocked", effect: "deny", principals: ["user:carl"], actions: ["doc:Edit"]}]},
        {on: rn.abc, statements: [{sid: "delete-needs-owner-org-member", effect: "deny", principals: ["everyone"], except: ["group:abc"], actions: ["doc:Delete"]}]},
    ],
}

const resolver = new GGAuthzMemoryResolver({
    parents: {
        [rn.readme]: rn.folderA,
        [rn.budget]: rn.planning,
        [rn.tooling]: rn.contoso,
        [rn.meetingNotes]: rn.notes,
        [rn.abcPlanning]: rn.abc,
        [rn.txA]: rn.account,
        [rn.account]: rn.westSide,
    },
    groups: {
        "user:11": ["group:eng"],
        "user:anne": ["group:xyz", "role:media-manager"],
        "user:beth": ["group:xyz", "role:media-viewer"],
        "user:charles": ["group:xyz", "team:contoso-engineering"],
        "user:diane": ["team:contoso-protocols", "team:contoso-engineering"],
        "user:erik": ["group:contoso-members"],
        "user:alice": ["team:writers"],
        "user:becky": ["team:product", "group:abc"],
        "user:carl": ["team:product", "group:xyz-org"],
    },
})

const grantWindow = {from: Date.parse("2023-01-01T00:00:00Z"), ms: 10 * 60_000}
const branchNetworks: Record<string, string> = {[rn.westSide]: "10.0."}
const facts: GGAuthzFacts = (name, request) => {
    const ctx = request.context ?? {}
    if (name === "nonExpiredGrant") return Date.parse(String(ctx.current_time)) < grantWindow.from + grantWindow.ms
    if (name === "approvedContext") {
        const branch = resolveBranch(request.resource.id)
        const ip = String(ctx.ip ?? "")
        const hour = Number(ctx.hourUtc)
        return !!branch && ip.startsWith(branchNetworks[branch] ?? "-") && hour >= 11 && hour < 13
    }
    return false
}

function resolveBranch(id: string): string | undefined {
    return [id, ...resolver.ancestors(id)].find(p => GGAuthzRn.type(p) === "bank:branch")
}

const authz = new GGAuthz({model, policies, resolver, facts})

function user(id: string): GGAuthzSubject {
    return {type: "user", id}
}

async function can(subject: string, action: string, resource: string, context?: Record<string, unknown>): Promise<boolean> {
    return (await authz.evaluate({subject: user(subject), action: {name: action}, resource: {type: GGAuthzRn.type(resource)!, id: resource}, context})).decision
}

async function listObjects(subject: string, action: string, type: string): Promise<string[]> {
    const plan = await authz.listAllowed({subject: user(subject), action: {name: action}, resource: {type}})
    const rows = Object.values(rn).filter(x => GGAuthzRn.type(x) === type)
    const listed = GGAuthz.applyPlan(plan, rows, {resolver})
    expect(listed).toEqual(await filterAsync(rows, x => can(subject, action, x)))
    return listed
}

describe("Zanzibar paper namespace config (https://www.usenix.org/conference/atc19/presentation/pang)", () => {
    test("_this: direct relation tuple doc:readme#owner@10", async () => {
        expect(await can("10", "zdoc:ChangeOwner", rn.readme)).toBe(true)
        expect(await can("12", "zdoc:ChangeOwner", rn.readme)).toBe(false)
    })
    test("computed_userset: owner ⊂ editor ⊂ viewer", async () => {
        expect(await can("10", "zdoc:Write", rn.readme)).toBe(true)
        expect(await can("10", "zdoc:Read", rn.readme)).toBe(true)
    })
    test("userset subject doc:readme#editor@group:eng#member", async () => {
        expect(await can("11", "zdoc:Write", rn.readme)).toBe(true)
        expect(await can("11", "zdoc:ChangeOwner", rn.readme)).toBe(false)
    })
    test("tuple_to_userset: viewer of parent folder is viewer of doc, and only viewer", async () => {
        expect(await can("12", "zdoc:Read", rn.readme)).toBe(true)
        expect(await can("12", "zdoc:Write", rn.readme)).toBe(false)
    })
})

describe("OpenFGA Google Drive (https://openfga.dev/docs/modeling/advanced/gdrive)", () => {
    test("direct relation: beth is commenter of 2021-budget", async () => {
        expect(await can("beth", "drive:Comment", rn.budget)).toBe(true)
    })
    test("concentric relations: owner anne is also writer", async () => {
        expect(await can("anne", "drive:Own", rn.budget)).toBe(true)
        expect(await can("anne", "drive:Write", rn.budget)).toBe(true)
    })
    test("domain:xyz#member userset: charles is viewer", async () => {
        expect(await can("charles", "drive:View", rn.budget)).toBe(true)
    })
    test("viewer from parent: diane views 2021-budget via 2021-planning", async () => {
        expect(await can("diane", "drive:View", rn.budget)).toBe(true)
        expect(await can("diane", "drive:Comment", rn.budget)).toBe(false)
    })
    test("type-bound public access user:* on 2021-public-roadmap", async () => {
        expect(await can("anne", "drive:Own", rn.roadmap)).toBe(true)
        expect(await can("beth", "drive:Write", rn.roadmap)).toBe(false)
        expect(await can("beth", "drive:Comment", rn.roadmap)).toBe(true)
        expect(await can("erik", "drive:Write", rn.roadmap)).toBe(false)
        expect(await can("erik", "drive:View", rn.roadmap)).toBe(true)
    })
    test("ListObjects: docs diane can view", async () => {
        expect((await listObjects("diane", "drive:View", "drive:doc")).sort()).toEqual([rn.budget, rn.planning, rn.roadmap].sort())
        expect(await listObjects("erik", "drive:View", "drive:doc")).toEqual([rn.roadmap])
    })
})

describe("OpenFGA GitHub (https://openfga.dev/docs/modeling/advanced/github)", () => {
    test("direct reader anne", async () => {
        expect(await can("anne", "gh:Read", rn.tooling)).toBe(true)
        expect(await can("anne", "gh:Write", rn.tooling)).toBe(false)
    })
    test("concentric: writer beth is reader", async () => {
        expect(await can("beth", "gh:Read", rn.tooling)).toBe(true)
    })
    test("team:contoso/engineering#member is admin: charles", async () => {
        expect(await can("charles", "gh:Admin", rn.tooling)).toBe(true)
    })
    test("nested team protocols ⊂ engineering via transitive resolver groups: diane is admin", async () => {
        expect(await can("diane", "gh:Admin", rn.tooling)).toBe(true)
    })
    test("repo_admin from owner: organization:contoso#member is repo_admin, erik is admin", async () => {
        expect(await can("erik", "gh:Admin", rn.tooling)).toBe(true)
        expect(await listObjects("erik", "gh:Admin", "gh:repo")).toEqual([rn.tooling])
    })
})

describe("OpenFGA user groups (https://openfga.dev/docs/modeling/user-groups)", () => {
    test("team:writers#member editor: alice can edit meeting_notes.doc", async () => {
        expect(await can("alice", "doc:Edit", rn.meetingNotes)).toBe(true)
        expect(await can("becky", "doc:Edit", rn.meetingNotes)).toBe(false)
    })
})

describe("OpenFGA parent-child objects (https://openfga.dev/docs/modeling/parent-child)", () => {
    test("editor from parent: bob edits meeting_notes.doc via folder:notes", async () => {
        expect(await can("bob", "doc:Edit", rn.meetingNotes)).toBe(true)
        expect(await listObjects("bob", "doc:Edit", "doc:document")).toEqual([rn.meetingNotes])
    })
})

describe("OpenFGA blocklists (https://openfga.dev/docs/modeling/blocklists)", () => {
    test("editor but not blocked: carl blocked, becky still editor", async () => {
        expect(await can("carl", "doc:Edit", rn.planningDoc)).toBe(false)
        expect(await can("becky", "doc:Edit", rn.planningDoc)).toBe(true)
        expect(await listObjects("carl", "doc:Edit", "doc:document")).not.toContain(rn.planningDoc)
    })
})

describe("OpenFGA multiple restrictions (https://openfga.dev/docs/modeling/multiple-restrictions)", () => {
    // `can_delete: writer and member from owner` as a deny-with-except on the owning org (the doc's parent).
    test("can_write: both writers", async () => {
        expect(await can("becky", "doc:Edit", rn.abcPlanning)).toBe(true)
        expect(await can("carl", "doc:Edit", rn.abcPlanning)).toBe(true)
    })
    test("can_delete: writer and member of owner org", async () => {
        expect(await can("becky", "doc:Delete", rn.abcPlanning)).toBe(true)
        expect(await can("carl", "doc:Delete", rn.abcPlanning)).toBe(false)
        expect(await listObjects("becky", "doc:Delete", "doc:document")).toEqual([rn.abcPlanning])
        expect(await listObjects("carl", "doc:Delete", "doc:document")).toEqual([])
    })
})

describe("OpenFGA public access (https://openfga.dev/docs/modeling/public-access)", () => {
    test("user:* viewer: bob can view company-psa.doc", async () => {
        expect(await can("bob", "doc:View", rn.psa)).toBe(true)
        expect((await authz.evaluate({subject: {type: "employee", id: "bob"}, action: {name: "doc:View"}, resource: {type: "doc:document", id: rn.psa}})).decision).toBe(false)
    })
})

describe("OpenFGA conditions (https://openfga.dev/docs/modeling/conditions)", () => {
    // Covered via caller-computed fact: the caller evaluates non_expired_grant from its own grant_time/duration.
    test("non_expired_grant: inside window allowed, outside denied", async () => {
        expect(await can("anne", "doc:View", rn.doc1, {current_time: "2023-01-01T00:09:50Z"})).toBe(true)
        expect(await can("anne", "doc:View", rn.doc1, {current_time: "2023-01-01T00:10:01Z"})).toBe(false)
    })
    test("ListObjects with condition context: document:1", async () => {
        const plan = await authz.listAllowed({subject: user("anne"), action: {name: "doc:View"}, resource: {type: "doc:document"}})
        const rows = Object.values(rn).filter(x => GGAuthzRn.type(x) === "doc:document")
        const at = (time: string) => GGAuthz.applyPlan(plan, rows, {resolver, facts: name => facts(name, {subject: user("anne"), action: {name: "doc:View"}, resource: {type: "doc:document", id: ""}, context: {current_time: time}})})
        const perRow = (time: string) => filterAsync(rows, x => can("anne", "doc:View", x, {current_time: time}))
        expect(at("2023-01-01T00:09:50Z")).toEqual(await perRow("2023-01-01T00:09:50Z"))
        expect(at("2023-01-01T00:09:50Z")).toEqual([rn.psa, rn.doc1])
        expect(at("2023-01-01T00:10:01Z")).toEqual([rn.psa])
    })
})

describe("OpenFGA roles and permissions (https://openfga.dev/docs/modeling/roles-and-permissions)", () => {
    test("booking_viewer: viewer or owner; booking_adder: owner", async () => {
        expect(await can("bob", "trip:ViewBookings", rn.europe)).toBe(true)
        expect(await can("bob", "trip:AddBooking", rn.europe)).toBe(false)
        expect(await can("alice", "trip:ViewBookings", rn.europe)).toBe(true)
        expect(await can("alice", "trip:AddBooking", rn.europe)).toBe(true)
    })
})

describe("OpenFGA custom roles (https://openfga.dev/docs/modeling/custom-roles)", () => {
    test("role:media-manager#assignee editor of asset-category:logos", async () => {
        expect(await can("anne", "asset:Edit", rn.logos)).toBe(true)
        expect(await can("beth", "asset:Edit", rn.logos)).toBe(false)
        expect(await can("beth", "asset:View", rn.logos)).toBe(true)
    })
})

describe("OpenFGA contextual and time-based authorization (https://openfga.dev/docs/modeling/contextual-time-based-authorization)", () => {
    // Covered via caller-computed fact: approved_context (IP range ∧ timeslot of the account's branch) is one boolean.
    test("customer views own transaction; manager of another branch doesn't", async () => {
        expect(await can("caroline", "bank:View", rn.txA)).toBe(true)
        expect(await can("mary", "bank:View", rn.txA, {ip: "10.0.1.5", hourUtc: 12})).toBe(false)
    })
    test("anne at the branch at 12 UTC may view transaction A", async () => {
        expect(await can("anne", "bank:View", rn.txA, {ip: "10.0.1.5", hourUtc: 12})).toBe(true)
    })
    test("remote without VPN denied; with VPN at 12 allowed, at 18 denied", async () => {
        expect(await can("anne", "bank:View", rn.txA, {ip: "203.0.113.9", hourUtc: 12})).toBe(false)
        expect(await can("anne", "bank:View", rn.txA, {ip: "10.0.200.1", hourUtc: 12})).toBe(true)
        expect(await can("anne", "bank:View", rn.txA, {ip: "10.0.200.1", hourUtc: 18})).toBe(false)
    })
})
