import {describe, expect, test} from "vitest"
import {GGAuthz, type GGAuthzMemoryData, GGAuthzMemoryResolver, type GGAuthzModel, type GGAuthzPolicies} from "../../src/index-node"
import {req} from "../util"

const org = "rn:gcp:crm:acme:organization/123"
const folderEng = "rn:gcp:crm:acme:folder/eng"
const folderOps = "rn:gcp:crm:acme:folder/ops"
const project1 = "rn:gcp:crm:acme:project/project-1"
const project2 = "rn:gcp:crm:acme:project/project-2"
const topicA = "rn:gcp:pubsub:acme:topic/topic-a"
const uploads = "rn:gcp:storage:acme:bucket/uploads"
const assets = "rn:gcp:storage:acme:bucket/assets"
const opsLogs = "rn:gcp:storage:acme:bucket/ops-logs"
const object = (bucket: string, id: string) => `${bucket}/object/${id}`
const instance1 = "rn:gcp:compute:acme:instance/web-1"
const instance2 = "rn:gcp:compute:acme:instance/ops-1"
const network1 = "rn:gcp:compute:acme:network/vpc-1"
const network2 = "rn:gcp:compute:acme:network/vpc-2"
const deployer = "rn:gcp:iam:acme:service-account/deployer"

const model: GGAuthzModel = {
    partition: "gcp",
    actions: [
        {name: "crm:GetProject", resourceTypes: ["crm:project"]},
        {name: "crm:DeleteProject", resourceTypes: ["crm:project"]},
        {name: "pubsub:GetTopic", resourceTypes: ["pubsub:topic"]},
        {name: "pubsub:UpdateTopic", resourceTypes: ["pubsub:topic"]},
        {name: "pubsub:Publish", resourceTypes: ["pubsub:topic"]},
        {name: "storage:GetBucket", resourceTypes: ["storage:bucket"]},
        {name: "storage:CreateObject", resourceTypes: ["storage:bucket"]},
        {name: "storage:GetObject", resourceTypes: ["storage:object"]},
        {name: "storage:DeleteObject", resourceTypes: ["storage:object"]},
        {name: "compute:GetInstance", resourceTypes: ["compute:instance"]},
        {name: "compute:StartInstance", resourceTypes: ["compute:instance"]},
        {name: "compute:UpdateNetwork", resourceTypes: ["compute:network"]},
        {name: "iam:GetAccessToken", resourceTypes: ["iam:service-account"]},
    ],
    roles: [
        {name: "roles/owner", actions: ["crm:*", "pubsub:*", "storage:*", "compute:*", "iam:*"]},
        {name: "roles/editor", actions: ["crm:GetProject", "pubsub:*", "storage:*", "compute:*"]},
        {name: "roles/viewer", actions: ["crm:GetProject", "pubsub:GetTopic", "storage:GetBucket", "storage:GetObject", "compute:GetInstance"]},
        {name: "roles/pubsub.publisher", actions: ["pubsub:Publish"]},
        {name: "roles/storage.objectAdmin", actions: ["storage:*"]},
        {name: "roles/storage.objectCreator", actions: ["storage:CreateObject"]},
        {name: "roles/storage.objectViewer", actions: ["storage:GetBucket", "storage:GetObject"]},
        {name: "roles/compute.networkAdmin", actions: ["compute:UpdateNetwork"]},
        {name: "roles/compute.instanceAdmin", actions: ["compute:GetInstance", "compute:StartInstance"]},
        {name: "roles/iam.serviceAccountTokenCreator", actions: ["iam:GetAccessToken"]},
        {name: "organizations/123/roles/objectReader", actions: ["storage:GetObject"]},
    ],
}

const parents: Record<string, string> = {
    [folderEng]: org,
    [folderOps]: org,
    [project1]: folderEng,
    [project2]: folderOps,
    [topicA]: project1,
    [uploads]: project1,
    [assets]: project1,
    [opsLogs]: project2,
    [object(uploads, "a.txt")]: uploads,
    [object(uploads, "test-object-1")]: uploads,
    [object(assets, "logo.png")]: assets,
    [object(opsLogs, "log-1")]: opsLogs,
    [instance1]: project1,
    [instance2]: project2,
    [network1]: project1,
    [network2]: project2,
    [deployer]: project1,
}

function engine(policies: GGAuthzPolicies, groups: Record<string, string[]> = {}, tree: Record<string, string> = parents) {
    const data: GGAuthzMemoryData = {parents: tree, groups}
    const authz = new GGAuthz({model, policies, resolver: new GGAuthzMemoryResolver(data)})
    return (principal: string, action: string, resource: string, context?: Record<string, unknown>) => authz.evaluate(req(principal, action, resource, {context}))
}

describe("resource hierarchy: https://docs.cloud.google.com/iam/docs/resource-hierarchy-access-control", () => {
    test("Editor on project_1 and Publisher on topic_a both reach topic_a (effective policy is the union)", async () => {
        const ask = engine({bindings: [
            {principal: "user:kalani", role: "roles/editor", on: project1},
            {principal: "user:nur", role: "roles/pubsub.publisher", on: topicA},
        ]})
        expect((await ask("user:kalani", "pubsub:UpdateTopic", topicA)).decision).toBe(true)
        expect((await ask("user:nur", "pubsub:Publish", topicA)).decision).toBe(true)
        expect((await ask("user:nur", "pubsub:UpdateTopic", topicA)).decision).toBe(false)
    })

    test("Storage Object Admin on the project vs Storage Object Creator for data-uploaders", async () => {
        const ask = engine({bindings: [
            {principal: "user:nur", role: "roles/storage.objectAdmin", on: project1},
            {principal: "group:data-uploaders", role: "roles/storage.objectCreator", on: project1},
        ]}, {"user:robin": ["group:data-uploaders"]})
        for (const o of [object(uploads, "a.txt"), object(assets, "logo.png")]) {
            expect((await ask("user:nur", "storage:GetObject", o)).decision).toBe(true)
            expect((await ask("user:nur", "storage:DeleteObject", o)).decision).toBe(true)
            expect((await ask("user:robin", "storage:GetObject", o)).decision).toBe(false)
            expect((await ask("user:robin", "storage:DeleteObject", o)).decision).toBe(false)
        }
        expect((await ask("user:robin", "storage:CreateObject", uploads)).decision).toBe(true)
    })

    test("Network Admin on the organization vs Instance Admin on project_2", async () => {
        const ask = engine({bindings: [
            {principal: "user:kalani", role: "roles/compute.networkAdmin", on: org},
            {principal: "user:nur", role: "roles/compute.instanceAdmin", on: project2},
        ]})
        expect((await ask("user:kalani", "compute:UpdateNetwork", network1)).decision).toBe(true)
        expect((await ask("user:kalani", "compute:UpdateNetwork", network2)).decision).toBe(true)
        expect((await ask("user:nur", "compute:StartInstance", instance2)).decision).toBe(true)
        expect((await ask("user:nur", "compute:UpdateNetwork", network2)).decision).toBe(false)
        expect((await ask("user:nur", "compute:StartInstance", instance1)).decision).toBe(false)
    })

    test("a child policy can't revoke a grant inherited from an ancestor", async () => {
        const ask = engine({bindings: [
            {principal: "user:kalani", role: "roles/viewer", on: org},
            {principal: "user:nur", role: "roles/storage.objectViewer", on: uploads},
        ]})
        expect((await ask("user:kalani", "storage:GetObject", object(uploads, "a.txt"))).decision).toBe(true)
    })
})

describe("moving a project: https://docs.cloud.google.com/resource-manager/docs/project-migration", () => {
    test("roles granted on the source folder are lost, roles on the project stay", async () => {
        const policies: GGAuthzPolicies = {bindings: [
            {principal: "user:kalani", role: "roles/viewer", on: folderEng},
            {principal: "user:nur", role: "roles/viewer", on: project1},
        ]}
        const before = engine(policies)
        const after = engine(policies, {}, {...parents, [project1]: folderOps})
        expect((await before("user:kalani", "crm:GetProject", project1)).decision).toBe(true)
        expect((await after("user:kalani", "crm:GetProject", project1)).decision).toBe(false)
        expect((await after("user:nur", "crm:GetProject", project1)).decision).toBe(true)
    })
})

describe("roles: https://docs.cloud.google.com/iam/docs/overview", () => {
    test("basic Owner is broad, Viewer is read-only", async () => {
        const ask = engine({bindings: [
            {principal: "user:kalani", role: "roles/owner", on: project1},
            {principal: "user:nur", role: "roles/viewer", on: project1},
        ]})
        expect((await ask("user:kalani", "crm:DeleteProject", project1)).decision).toBe(true)
        expect((await ask("user:kalani", "compute:StartInstance", instance1)).decision).toBe(true)
        expect((await ask("user:nur", "compute:GetInstance", instance1)).decision).toBe(true)
        expect((await ask("user:nur", "compute:StartInstance", instance1)).decision).toBe(false)
    })

    test("a custom role contains only the permissions you specify", async () => {
        const ask = engine({bindings: [{principal: "user:nur", role: "organizations/123/roles/objectReader", on: project1}]})
        expect((await ask("user:nur", "storage:GetObject", object(uploads, "a.txt"))).decision).toBe(true)
        expect((await ask("user:nur", "storage:GetBucket", uploads)).decision).toBe(false)
        expect((await ask("user:nur", "storage:DeleteObject", object(uploads, "a.txt"))).decision).toBe(false)
    })
})

describe("principals: https://docs.cloud.google.com/iam/docs/principals-overview", () => {
    test("allUsers includes unauthenticated visitors", async () => {
        const ask = engine({bindings: [{principal: "everyone", role: "roles/storage.objectViewer", on: uploads}]})
        expect((await ask("anonymous:visitor", "storage:GetObject", object(uploads, "a.txt"))).decision).toBe(true)
        expect((await ask("anonymous:visitor", "storage:GetObject", object(assets, "logo.png"))).decision).toBe(false)
    })

    test("allAuthenticatedUsers includes service accounts but not anonymous visitors (membership from the resolver)", async () => {
        const ask = engine(
            {bindings: [{principal: "group:allAuthenticatedUsers", role: "roles/storage.objectViewer", on: uploads}]},
            {"user:alex": ["group:allAuthenticatedUsers"], "serviceaccount:deployer": ["group:allAuthenticatedUsers"]},
        )
        expect((await ask("user:alex", "storage:GetObject", object(uploads, "a.txt"))).decision).toBe(true)
        expect((await ask("serviceaccount:deployer", "storage:GetObject", object(uploads, "a.txt"))).decision).toBe(true)
        expect((await ask("anonymous:visitor", "storage:GetObject", object(uploads, "a.txt"))).decision).toBe(false)
    })

    test("domain: is a virtual group of every account in the domain (membership from the resolver)", async () => {
        const ask = engine(
            {bindings: [{principal: "domain:example.com", role: "roles/viewer", on: project1}]},
            {"user:alex": ["domain:example.com"]},
        )
        expect((await ask("user:alex", "crm:GetProject", project1)).decision).toBe(true)
        expect((await ask("user:mallory", "crm:GetProject", project1)).decision).toBe(false)
    })
})

describe("deny policies: https://docs.cloud.google.com/iam/docs/deny-overview", () => {
    test("deny is checked before allow: a denied permission blocks even an Owner", async () => {
        const ask = engine({
            bindings: [{principal: "user:kalani", role: "roles/owner", on: project1}],
            guardrails: [{id: "no-project-delete", on: org, principals: ["everyone"], deny: [{actions: ["crm:DeleteProject"]}]}],
        })
        const d = await ask("user:kalani", "crm:DeleteProject", project1)
        expect(d.decision).toBe(false)
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "guardrail", kind: "denied", id: "no-project-delete", on: org})])
        expect((await ask("user:kalani", "crm:GetProject", project1)).decision).toBe(true)
    })

    test("a deny on a folder applies to its projects and their resources, not to other folders", async () => {
        const ask = engine({
            bindings: [{principal: "group:contractors", role: "roles/storage.objectAdmin", on: org}],
            guardrails: [{id: "eng-no-delete", on: folderEng, principals: ["group:contractors"], deny: [{actions: ["storage:DeleteObject"]}]}],
        }, {"user:dana": ["group:contractors"]})
        expect((await ask("user:dana", "storage:DeleteObject", object(uploads, "a.txt"))).decision).toBe(false)
        expect((await ask("user:dana", "storage:DeleteObject", object(opsLogs, "log-1"))).decision).toBe(true)
    })

    test("a deny higher up still applies when lower levels have no (more permissive) deny", async () => {
        const ask = engine({
            bindings: [{principal: "user:kalani", role: "roles/owner", on: project1}],
            guardrails: [
                {id: "org-deny", on: org, deny: [{actions: ["storage:DeleteObject"]}]},
                {id: "project-deny", on: project1, deny: [{actions: ["pubsub:UpdateTopic"]}]},
            ],
        })
        expect((await ask("user:kalani", "storage:DeleteObject", object(uploads, "a.txt"))).decision).toBe(false)
    })

    test("exception principals: deny a group but exempt specific users who belong to it", async () => {
        const ask = engine({
            bindings: [{principal: "group:eng", role: "roles/owner", on: project1}],
            guardrails: [{id: "eng-no-delete", on: project1, principals: ["group:eng"], except: ["user:robin", "group:project-admins"], deny: [{actions: ["crm:DeleteProject"]}]}],
        }, {"user:robin": ["group:eng"], "user:dana": ["group:eng"], "user:alex": ["group:eng", "group:project-admins"]})
        expect((await ask("user:dana", "crm:DeleteProject", project1)).decision).toBe(false)
        expect((await ask("user:robin", "crm:DeleteProject", project1)).decision).toBe(true)
        expect((await ask("user:alex", "crm:DeleteProject", project1)).decision).toBe(true)
    })

    test("principalSet://goog/public:all denies every principal", async () => {
        const ask = engine({
            bindings: [{principal: "everyone", role: "roles/storage.objectViewer", on: uploads}],
            guardrails: [{id: "public-all", on: project1, principals: ["everyone"], deny: [{actions: ["storage:GetObject"]}]}],
        })
        expect((await ask("anonymous:visitor", "storage:GetObject", object(uploads, "a.txt"))).decision).toBe(false)
        expect((await ask("serviceaccount:deployer", "storage:GetObject", object(uploads, "a.txt"))).decision).toBe(false)
    })

    // covered via caller-computed fact: tagEnvTest = resource.matchTag('12345678/env', 'test')
    test("denial condition !resource.matchTag(env, test): the rule applies when it is true or cannot be evaluated", async () => {
        const ask = engine({
            bindings: [{principal: "group:eng", role: "roles/owner", on: project1}],
            guardrails: [{id: "tagged", on: project1, except: ["group:project-admins"], deny: [{actions: ["storage:DeleteObject"], unless: ["tagEnvTest"]}]}],
        }, {"user:dana": ["group:eng"], "user:alex": ["group:eng", "group:project-admins"]})
        const o = object(uploads, "a.txt")
        expect((await ask("user:dana", "storage:DeleteObject", o, {tagEnvTest: true})).decision).toBe(true)
        expect((await ask("user:dana", "storage:DeleteObject", o, {tagEnvTest: false})).decision).toBe(false)
        expect((await ask("user:dana", "storage:DeleteObject", o)).decision).toBe(false)
        expect((await ask("user:alex", "storage:DeleteObject", o)).decision).toBe(true)
    })
})

describe("principal access boundary: https://docs.cloud.google.com/iam/docs/principal-access-boundary-policies", () => {
    const bindings: GGAuthzPolicies["bindings"] = [
        {principal: "user:kalani", role: "roles/viewer", on: org},
        {principal: "user:nur", role: "roles/viewer", on: org},
        {principal: "everyone", role: "roles/storage.objectAdmin", on: opsLogs},
    ]
    const groups = {"user:kalani": ["group:pool-eng"], "user:robin": ["group:pool-eng"]}
    const ask = engine({bindings, boundaries: [{id: "eng-only", principals: ["group:pool-eng"], allow: [{actions: ["crm:*", "pubsub:*", "storage:*", "compute:*", "iam:*"], resources: [folderEng]}]}]}, groups)

    // Rule resources cover descendants: https://docs.cloud.google.com/iam/docs/reference/rest/v3beta/organizations.locations.principalAccessBoundaryPolicies
    test("a principal can't access a resource it isn't eligible for, even if an allow policy grants it", async () => {
        expect((await ask("user:kalani", "crm:GetProject", project1)).decision).toBe(true)
        const d = await ask("user:kalani", "crm:GetProject", project2)
        expect(d.decision).toBe(false)
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "boundary", kind: "ceiling-failed", id: "eng-only"})])
    })

    test("a principal subject to no boundary is eligible for every resource", async () => {
        expect((await ask("user:nur", "crm:GetProject", project2)).decision).toBe(true)
    })

    test("a boundary can't grant access", async () => {
        expect((await ask("user:robin", "crm:GetProject", project1)).decision).toBe(false)
    })

    test("rules within one policy are additive", async () => {
        const additive = engine({bindings, boundaries: [{id: "two-rules", principals: ["group:pool-eng"], allow: [
            {actions: ["crm:*"], resources: [folderEng]},
            {actions: ["crm:*"], resources: [project2]},
        ]}]}, groups)
        expect((await additive("user:kalani", "crm:GetProject", project1)).decision).toBe(true)
        expect((await additive("user:kalani", "crm:GetProject", project2)).decision).toBe(true)
    })

    test("ineligible principals still can't modify or delete publicly visible resources", async () => {
        expect((await ask("user:kalani", "storage:DeleteObject", object(opsLogs, "log-1"))).decision).toBe(false)
        expect((await ask("anonymous:visitor", "storage:DeleteObject", object(opsLogs, "log-1"))).decision).toBe(true)
    })

    // covered via caller-computed fact: the resolver puts only service accounts of the set in group:org-sa (principal.type condition)
    test("binding condition on principal.type limits the boundary to service accounts", async () => {
        const saOnly = engine({
            bindings: [...bindings!, {principal: "serviceaccount:deployer", role: "roles/viewer", on: org}],
            boundaries: [{id: "sa-only", principals: ["group:org-sa"], allow: [{actions: ["crm:*"], resources: [folderEng]}]}],
        }, {"serviceaccount:deployer": ["group:org-sa"]})
        expect((await saOnly("serviceaccount:deployer", "crm:GetProject", project1)).decision).toBe(true)
        expect((await saOnly("serviceaccount:deployer", "crm:GetProject", project2)).decision).toBe(false)
        expect((await saOnly("user:kalani", "crm:GetProject", project2)).decision).toBe(true)
    })
})

describe("IAM Conditions: https://docs.cloud.google.com/iam/docs/conditions-overview", () => {
    // covered via caller-computed fact: beforeExpiry = request.time < timestamp("2022-04-12T00:00:00Z")
    test("request.time: a conditional binding grants only while the condition is true", async () => {
        const ask = engine({bindings: [{principal: "user:alex", role: "roles/viewer", on: project1, when: ["beforeExpiry"]}]})
        expect((await ask("user:alex", "crm:GetProject", project1, {beforeExpiry: true})).decision).toBe(true)
        expect((await ask("user:alex", "crm:GetProject", project1, {beforeExpiry: false})).decision).toBe(false)
    })

    test("conditional role bindings don't override role bindings with no conditions", async () => {
        const ask = engine({bindings: [
            {principal: "user:alex", role: "roles/viewer", on: project1},
            {principal: "user:alex", role: "roles/viewer", on: project1, when: ["beforeExpiry"]},
        ]})
        expect((await ask("user:alex", "crm:GetProject", project1)).decision).toBe(true)
    })

    // https://docs.cloud.google.com/iam/docs/conditions-attribute-reference
    test("resource.name.startsWith(bucket) matches the bucket and its objects (allow statement with an RN matcher)", async () => {
        const ask = engine({resourcePolicies: [{on: project1, statements: [
            {sid: "uploads-only", effect: "allow", principals: ["user:nur"], actions: ["storage:GetBucket", "storage:GetObject"], resources: [uploads]},
        ]}]})
        expect((await ask("user:nur", "storage:GetBucket", uploads)).decision).toBe(true)
        expect((await ask("user:nur", "storage:GetObject", object(uploads, "a.txt"))).decision).toBe(true)
        expect((await ask("user:nur", "storage:GetObject", object(assets, "logo.png"))).decision).toBe(false)
    })

    // covered via caller-computed fact: testObject = resource.name.startsWith("projects/_/buckets/uploads/objects/test-object-")
    test("resource.name.startsWith on an arbitrary name prefix", async () => {
        const ask = engine({bindings: [{principal: "user:nur", role: "roles/storage.objectViewer", on: uploads, when: ["testObject"]}]})
        expect((await ask("user:nur", "storage:GetObject", object(uploads, "test-object-1"), {testObject: true})).decision).toBe(true)
        expect((await ask("user:nur", "storage:GetObject", object(uploads, "a.txt"), {testObject: false})).decision).toBe(false)
    })

    // covered via caller-computed fact: isInstance = resource.type == "compute.googleapis.com/Instance"; tagProd = resource.matchTag('123456789012/env', 'prod')
    test("resource.type and resource.matchTag in a project-level conditional binding", async () => {
        const ask = engine({bindings: [{principal: "user:nur", role: "roles/editor", on: project1, when: ["isInstance", "tagProd"]}]})
        expect((await ask("user:nur", "compute:StartInstance", instance1, {isInstance: true, tagProd: true})).decision).toBe(true)
        expect((await ask("user:nur", "compute:StartInstance", instance1, {isInstance: true, tagProd: false})).decision).toBe(false)
        expect((await ask("user:nur", "compute:UpdateNetwork", network1, {isInstance: false, tagProd: true})).decision).toBe(false)
    })
})

describe("service account impersonation: https://docs.cloud.google.com/iam/docs/service-account-impersonation", () => {
    const ask = engine({bindings: [
        {principal: "user:alex", role: "roles/iam.serviceAccountTokenCreator", on: deployer},
        {principal: "user:alex", role: "roles/owner", on: project2},
        {principal: "user:kalani", role: "roles/iam.serviceAccountTokenCreator", on: project1},
        {principal: "serviceaccount:deployer", role: "roles/storage.objectViewer", on: uploads},
    ]})

    test("impersonating needs iam.serviceAccounts.getAccessToken on the service account (inherited from its project too)", async () => {
        expect((await ask("user:alex", "iam:GetAccessToken", deployer)).decision).toBe(true)
        expect((await ask("user:kalani", "iam:GetAccessToken", deployer)).decision).toBe(true)
        expect((await ask("user:robin", "iam:GetAccessToken", deployer)).decision).toBe(false)
    })

    test("the impersonating principal gets the service account's access, evaluated as the service account", async () => {
        expect((await ask("user:alex", "storage:GetObject", object(uploads, "a.txt"))).decision).toBe(false)
        expect((await ask("serviceaccount:deployer", "storage:GetObject", object(uploads, "a.txt"))).decision).toBe(true)
        expect((await ask("serviceaccount:deployer", "storage:GetObject", object(opsLogs, "log-1"))).decision).toBe(false)
    })
})
