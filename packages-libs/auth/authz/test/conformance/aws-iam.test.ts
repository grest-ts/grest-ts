import {describe, expect, test} from "vitest"
import {defineAuthzModel, defineAuthzService, defineAuthzTokenScope, GGAuthz, GGAuthzMemoryResolver, type GGAuthzPolicies, type GGAuthzStatement} from "../../src/index-node"
import {req} from "../util"

// Mapping: partition root above every organization (so SCPs and identity policies follow the principal anywhere)
// → org root → OU → account (tenant) → resources. Identity policies are statements at the partition root scoped by
// principal; SCPs are guardrails selected by account/OU group membership; RCPs are guardrails on the account/OU
// scope; permission boundaries are boundaries; session policies are token scopes.

const S3 = defineAuthzService("s3", {
    types: {bucket: "Bucket", object: "Object"},
    actions: {
        ListBucket: {on: ["bucket"]},
        DeleteBucket: {on: ["bucket"]},
        GetObject: {on: ["object"]},
        PutObject: {on: ["object"]},
        DeleteObject: {on: ["object"]},
    },
})
const Ec2 = defineAuthzService("ec2", {
    types: {instance: "Instance"},
    actions: {StartInstances: {on: ["instance"]}, TerminateInstances: {on: ["instance"]}},
})
const Iam = defineAuthzService("iam", {
    types: {user: "User"},
    actions: {CreateUser: {on: ["user"]}, ChangePassword: {on: ["user"]}},
})
const Cloudwatch = defineAuthzService("cloudwatch", {
    types: {dashboard: "Dashboard"},
    actions: {GetDashboard: {on: ["dashboard"]}, DeleteDashboards: {on: ["dashboard"]}},
})
const SecretsManager = defineAuthzService("secretsmanager", {
    types: {secret: "Secret"},
    actions: {GetSecretValue: {on: ["secret"]}},
})

const model = defineAuthzModel({
    partition: "aws",
    services: [S3, Ec2, Iam, Cloudwatch, SecretsManager],
    roles: [],
    tokenScopes: [
        defineAuthzTokenScope("session-s3-read", {allow: [{actions: [S3.GetObject]}]}),
        defineAuthzTokenScope("session-ec2", {allow: [{actions: [Ec2.all]}]}),
    ],
})

const partition = "rn:aws:org:aws:partition/aws"
const orgRoot = "rn:aws:org:o-1:root/r-1"
const ou = (id: string) => `rn:aws:org:o-1:ou/${id}`
const account = (id: string) => `rn:aws:org:o-1:account/${id}`
const external = "rn:aws:org:333333333333:account/333333333333"
const bucket = (acct: string, name: string) => `rn:aws:s3:${acct}:bucket/${name}`
const object = (acct: string, name: string, key: string) => `${bucket(acct, name)}/object/${key}`
const instance = (acct: string, id: string) => `rn:aws:ec2:${acct}:instance/${id}`
const iamUser = (acct: string, name: string) => `rn:aws:iam:${acct}:user/${name}`
const dashboard = (acct: string, name: string) => `rn:aws:cloudwatch:${acct}:dashboard/${name}`
const secret = (acct: string, name: string) => `rn:aws:secretsmanager:${acct}:secret/${name}`

const A = "111111111111"
const B = "222222222222"
const MGMT = "999999999999"
const EXT = "333333333333"

const parents: Record<string, string> = {
    [orgRoot]: partition,
    [ou("prod")]: orgRoot,
    [ou("sandbox")]: orgRoot,
    [account(A)]: ou("prod"),
    [account(B)]: ou("sandbox"),
    [account(MGMT)]: orgRoot,
    [external]: partition,
}
const accountNode: Record<string, string> = {[A]: account(A), [B]: account(B), [MGMT]: account(MGMT), [EXT]: external}
function place(rn: string, parent: string) {
    parents[rn] = parent
    return rn
}
for (const acct of [A, B, MGMT, EXT]) {
    for (const name of ["docs", "logs", "shared"]) {
        place(bucket(acct, name), accountNode[acct]!)
        for (const key of ["report", "secret"]) place(object(acct, name, key), bucket(acct, name))
    }
    place(instance(acct, "i-1"), accountNode[acct]!)
    place(iamUser(acct, "new-user"), accountNode[acct]!)
    place(dashboard(acct, "ops"), accountNode[acct]!)
    place(secret(acct, "db"), accountNode[acct]!)
}

const inA = ["group:acct-111111111111", "group:ou-prod", "group:org-members"]
const inB = ["group:acct-222222222222", "group:ou-sandbox", "group:org-members"]
const resolver = new GGAuthzMemoryResolver({
    parents,
    groups: {
        "user:alice": [...inA, "group:devs"],
        "user:bob": inA,
        "user:shirley": inA,
        "user:zhang": inA,
        "user:nikhil": inA,
        "role:demo": inA,
        "user:carol": inB,
        "user:mgmt-admin": ["group:acct-999999999999"],
        "user:outsider": ["group:acct-333333333333"],
        "slr:replication": inA,
    },
})

type Rule = Omit<GGAuthzStatement, "effect" | "principals">

function identity(principal: string, allow: Rule[], deny: Rule[] = []): GGAuthzPolicies["resourcePolicies"] & {} {
    return [{
        on: partition,
        statements: [
            ...allow.map(r => ({...r, effect: "allow" as const, principals: [principal]})),
            ...deny.map(r => ({...r, effect: "deny" as const, principals: [principal]})),
        ],
    }]
}

async function decide(policies: GGAuthzPolicies, principal: string, action: string, resource: string, extra: {context?: Record<string, unknown>, scopes?: string[]} = {}) {
    const authz = new GGAuthz({model, policies, resolver})
    return (await authz.evaluate(req(principal, action, resource, extra))).decision
}

const allS3 = {actions: ["s3:*"]}

describe("evaluation basics: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html", () => {
    test("by default all requests are implicitly denied", async () => {
        expect(await decide({}, "user:alice", "s3:GetObject", object(A, "docs", "report"))).toBe(false)
    })
    test("an explicit deny overrides an explicit allow", async () => {
        const policies = {resourcePolicies: identity("user:alice", [allS3], [{actions: ["s3:DeleteObject"]}])}
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"))).toBe(true)
        expect(await decide(policies, "user:alice", "s3:DeleteObject", object(A, "docs", "report"))).toBe(false)
    })
    test("an explicit deny in a resource-based policy overrides an identity-based allow", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: [
                ...identity("user:alice", [allS3]),
                {on: bucket(A, "docs"), statements: [{effect: "deny", principals: ["everyone"], actions: ["s3:PutObject"]}]},
            ],
        }
        expect(await decide(policies, "user:alice", "s3:PutObject", object(A, "docs", "report"))).toBe(false)
    })
    test("identity-based policies of a user's groups apply to the user", async () => {
        const policies = {resourcePolicies: identity("group:devs", [{actions: ["ec2:StartInstances"]}])}
        expect(await decide(policies, "user:alice", "ec2:StartInstances", instance(A, "i-1"))).toBe(true)
        expect(await decide(policies, "user:bob", "ec2:StartInstances", instance(A, "i-1"))).toBe(false)
    })
})

describe("same account: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html#policy-eval-basics-id-rdp", () => {
    test("permissions are the union of identity-based and resource-based policies: resource policy alone", async () => {
        const policies: GGAuthzPolicies = {resourcePolicies: [{on: bucket(A, "docs"), statements: [{effect: "allow", principals: ["user:alice"], actions: ["s3:GetObject"]}]}]}
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"))).toBe(true)
        expect(await decide(policies, "user:bob", "s3:GetObject", object(A, "docs", "report"))).toBe(false)
    })
    test("Principal \"*\" in an allow statement grants every principal in the account", async () => {
        const policies: GGAuthzPolicies = {resourcePolicies: [{on: bucket(A, "shared"), statements: [{effect: "allow", principals: ["everyone"], actions: ["s3:GetObject"]}]}]}
        expect(await decide(policies, "user:bob", "s3:GetObject", object(A, "shared", "report"))).toBe(true)
    })
})

describe("cross-account: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic-cross-account.html", () => {
    const grant: GGAuthzPolicies["resourcePolicies"] & {} = [{
        on: bucket(B, "docs"),
        statements: [{effect: "allow", principals: ["role:demo"], actions: ["s3:GetObject", "s3:PutObject"], resources: [`${bucket(B, "docs")}/*`]}],
    }]
    test("allowed when the trusted account's identity policy and the trusting account's resource policy both allow", async () => {
        const policies = {resourcePolicies: [...identity("role:demo", [{actions: ["s3:PutObject"], resources: [`${bucket(B, "docs")}/*`]}]), ...grant]}
        expect(await decide(policies, "role:demo", "s3:PutObject", object(B, "docs", "report"))).toBe(true)
    })
    test("an explicit deny in the trusted account's identity policy denies", async () => {
        const policies = {resourcePolicies: [...identity("role:demo", [allS3], [{actions: ["s3:*"], resources: [bucket(B, "docs")]}]), ...grant]}
        expect(await decide(policies, "role:demo", "s3:PutObject", object(B, "docs", "report"))).toBe(false)
    })
    test("resource policy actions outside the grant stay denied (bucket policy allows Put/Get, not Delete)", async () => {
        const policies = {resourcePolicies: [...identity("role:demo", [allS3]), ...grant]}
        expect(await decide(policies, "role:demo", "s3:GetObject", object(B, "docs", "report"))).toBe(true)
    })
})

describe("SCPs: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_evaluation.html", () => {
    const aliceAll = identity("user:alice", [{actions: ["s3:*", "ec2:*", "iam:*"]}])
    test("an SCP grants nothing on its own", async () => {
        const policies: GGAuthzPolicies = {guardrails: [{id: "scp-root", on: partition, principals: ["group:org-members"], ceiling: [{actions: ["s3:*", "ec2:*"]}]}]}
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"))).toBe(false)
    })
    test("identity policy ∩ SCP: an action the SCP doesn't allow is denied", async () => {
        const policies: GGAuthzPolicies = {resourcePolicies: aliceAll, guardrails: [{id: "scp-acct", on: partition, principals: ["group:acct-111111111111"], ceiling: [{actions: ["s3:*"]}]}]}
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"))).toBe(true)
        expect(await decide(policies, "user:alice", "ec2:StartInstances", instance(A, "i-1"))).toBe(false)
    })
    test("scenario 2/5: an Allow must exist at every level from the root to the account", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: aliceAll,
            guardrails: [{id: "scp-ou-prod-ec2-only", on: partition, principals: ["group:ou-prod"], ceiling: [{actions: ["ec2:*"]}]}],
        }
        expect(await decide(policies, "user:alice", "ec2:StartInstances", instance(A, "i-1"))).toBe(true)
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"))).toBe(false)
    })
    test("scenario 1: a Deny on an OU applies to every account below it", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: [...aliceAll, ...identity("user:carol", [{actions: ["s3:*"]}])],
            guardrails: [{id: "scp-ou-prod-deny-s3", on: partition, principals: ["group:ou-prod"], deny: [{actions: ["s3:*"]}]}],
        }
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"))).toBe(false)
        expect(await decide(policies, "user:carol", "s3:GetObject", object(B, "docs", "report"))).toBe(true)
    })
    test("scenario 6: a root-level Deny wins over a lower-level Allow", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: aliceAll,
            guardrails: [
                {id: "scp-root-deny-s3", on: partition, principals: ["group:org-members"], deny: [{actions: ["s3:*"]}]},
                {id: "scp-ou-allow-s3", on: partition, principals: ["group:ou-prod"], ceiling: [{actions: ["s3:*"]}]},
            ],
        }
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"))).toBe(false)
    })
    test("SCPs apply to the account's principals, also when they access resources outside the organization", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: [...aliceAll, {on: bucket(EXT, "shared"), statements: [{effect: "allow", principals: ["user:alice"], actions: ["s3:GetObject"]}]}],
            guardrails: [{id: "scp-acct-no-s3", on: partition, principals: ["group:acct-111111111111"], deny: [{actions: ["s3:*"]}]}],
        }
        expect(await decide(policies, "user:alice", "s3:GetObject", object(EXT, "shared", "report"))).toBe(false)
    })
    test("SCPs don't restrict principals outside the account accessing its resources", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: [
                ...identity("user:outsider", [{actions: ["s3:GetObject"]}]),
                {on: bucket(A, "shared"), statements: [{effect: "allow", principals: ["user:outsider"], actions: ["s3:GetObject"]}]},
            ],
            guardrails: [{id: "scp-acct-no-s3", on: partition, principals: ["group:acct-111111111111"], deny: [{actions: ["s3:*"]}]}],
        }
        expect(await decide(policies, "user:outsider", "s3:GetObject", object(A, "shared", "report"))).toBe(true)
    })
    // https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html
    test("SCPs don't affect principals in the management account", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: identity("user:mgmt-admin", [{actions: ["s3:*"]}]),
            guardrails: [{id: "scp-root-deny-s3", on: partition, principals: ["group:org-members"], deny: [{actions: ["s3:*"]}]}],
        }
        expect(await decide(policies, "user:mgmt-admin", "s3:GetObject", object(MGMT, "docs", "report"))).toBe(true)
    })
    test("SCPs don't affect service-linked roles", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: identity("slr:replication", [{actions: ["s3:*"]}]),
            guardrails: [{id: "scp-root-deny-s3", on: partition, principals: ["group:org-members"], except: ["slr:*"], deny: [{actions: ["s3:*"]}]}],
        }
        expect(await decide(policies, "slr:replication", "s3:PutObject", object(A, "docs", "report"))).toBe(true)
    })
})

describe("RCPs: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_rcps.html", () => {
    const denyExternal = {id: "rcp-deny-external", on: ou("prod"), except: ["group:org-members", "slr:*"], deny: [{actions: ["s3:*"]}]}
    const publicBucket = {on: bucket(A, "shared"), statements: [{effect: "allow" as const, principals: ["everyone"], actions: ["s3:*"]}]}
    test("an RCP grants nothing on its own", async () => {
        const policies: GGAuthzPolicies = {guardrails: [{id: "rcp", on: account(A), ceiling: [{actions: ["s3:*"]}]}]}
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"))).toBe(false)
    })
    test("an RCP restricts external principals even when the resource policy allows full access", async () => {
        const policies: GGAuthzPolicies = {resourcePolicies: [publicBucket, ...identity("user:outsider", [allS3])], guardrails: [denyExternal]}
        expect(await decide(policies, "user:outsider", "s3:GetObject", object(A, "shared", "report"))).toBe(false)
        expect(await decide(policies, "user:bob", "s3:GetObject", object(A, "shared", "report"))).toBe(true)
    })
    test("an RCP doesn't apply to resources in other accounts accessed by the account's users", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: [...identity("user:alice", [allS3]), {on: bucket(EXT, "shared"), statements: [{effect: "allow", principals: ["user:alice"], actions: ["s3:GetObject"]}]}],
            guardrails: [{id: "rcp-a", on: account(A), deny: [{actions: ["s3:*"]}]}],
        }
        expect(await decide(policies, "user:alice", "s3:GetObject", object(EXT, "shared", "report"))).toBe(true)
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"))).toBe(false)
    })
    test("a permission blocked at any level above the account is blocked for its resources", async () => {
        const policies: GGAuthzPolicies = {resourcePolicies: [publicBucket], guardrails: [{id: "rcp-root", on: orgRoot, deny: [{actions: ["s3:DeleteObject"]}]}]}
        expect(await decide(policies, "user:bob", "s3:DeleteObject", object(A, "shared", "report"))).toBe(false)
        expect(await decide(policies, "user:bob", "s3:GetObject", object(A, "shared", "report"))).toBe(true)
    })
    test("RCPs don't affect service-linked roles", async () => {
        const policies: GGAuthzPolicies = {resourcePolicies: identity("slr:replication", [allS3]), guardrails: [{...denyExternal, except: ["slr:*"]}]}
        expect(await decide(policies, "slr:replication", "s3:PutObject", object(A, "docs", "report"))).toBe(true)
    })
    test("identity ∩ SCP ∩ RCP: an explicit deny in an RCP overrides identity and SCP allows", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: identity("user:alice", [allS3]),
            guardrails: [
                {id: "scp", on: partition, principals: ["group:org-members"], ceiling: [{actions: ["s3:*"]}]},
                {id: "rcp", on: account(A), deny: [{actions: ["s3:PutObject"]}]},
            ],
        }
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"))).toBe(true)
        expect(await decide(policies, "user:alice", "s3:PutObject", object(A, "docs", "report"))).toBe(false)
    })
})

describe("permission boundaries: https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html", () => {
    const shirleyBoundary = {id: "shirley", principals: ["user:shirley"], allow: [{actions: ["s3:*", "cloudwatch:*", "ec2:*"]}]}
    test("Shirley example: the boundary blocks iam:CreateUser her identity policy allows", async () => {
        const policies: GGAuthzPolicies = {resourcePolicies: identity("user:shirley", [{actions: ["iam:CreateUser"]}]), boundaries: [shirleyBoundary]}
        expect(await decide(policies, "user:shirley", "iam:CreateUser", iamUser(A, "new-user"))).toBe(false)
    })
    test("a boundary grants nothing on its own", async () => {
        expect(await decide({boundaries: [shirleyBoundary]}, "user:shirley", "s3:GetObject", object(A, "docs", "report"))).toBe(false)
    })
    test("effective permissions are identity ∩ boundary", async () => {
        const policies: GGAuthzPolicies = {resourcePolicies: identity("user:shirley", [{actions: ["s3:GetObject"]}]), boundaries: [shirleyBoundary]}
        expect(await decide(policies, "user:shirley", "s3:GetObject", object(A, "docs", "report"))).toBe(true)
    })
    test("Zhang example: CloudWatch limited by policy, S3 blocked by the boundary", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: identity("user:zhang", [{actions: ["iam:*"]}, {actions: ["cloudwatch:GetDashboard"]}, {actions: ["s3:ListBucket"], resources: [bucket(A, "docs")]}]),
            boundaries: [{id: "delegated-user-boundary", principals: ["user:zhang"], allow: [{actions: ["cloudwatch:*", "iam:ChangePassword"]}]}],
        }
        expect(await decide(policies, "user:zhang", "cloudwatch:GetDashboard", dashboard(A, "ops"))).toBe(true)
        expect(await decide(policies, "user:zhang", "cloudwatch:DeleteDashboards", dashboard(A, "ops"))).toBe(false)
        expect(await decide(policies, "user:zhang", "s3:ListBucket", bucket(A, "docs"))).toBe(false)
        expect(await decide(policies, "user:zhang", "iam:ChangePassword", iamUser(A, "new-user"))).toBe(true)
        expect(await decide(policies, "user:zhang", "iam:CreateUser", iamUser(A, "new-user"))).toBe(false)
    })
    test("Zhang example: CreateUser only with the required boundary (covered via caller-computed fact)", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: identity("user:zhang", [{actions: ["iam:*"]}]),
            boundaries: [{id: "delegated-user-boundary", principals: ["user:zhang"], allow: [{actions: ["iam:CreateUser"], when: ["permissionsBoundaryIsXCompany"]}]}],
        }
        expect(await decide(policies, "user:zhang", "iam:CreateUser", iamUser(A, "new-user"))).toBe(false)
        expect(await decide(policies, "user:zhang", "iam:CreateUser", iamUser(A, "new-user"), {context: {permissionsBoundaryIsXCompany: true}})).toBe(true)
    })
    test("Nikhil example: an explicit deny in the boundary beats a bucket policy allow (boundary Deny as principal-scoped deny)", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: [
                ...identity("user:nikhil", [{actions: ["s3:GetObject"]}]),
                {on: bucket(A, "logs"), statements: [{effect: "allow", principals: ["user:nikhil"], actions: ["s3:PutObject"]}]},
            ],
            boundaries: [{id: "xcompany", principals: ["user:nikhil"], allow: [{actions: ["s3:*", "iam:ChangePassword"]}]}],
            guardrails: [{id: "xcompany-deny", on: partition, principals: ["user:nikhil"], deny: [{actions: ["s3:*"], resources: [bucket(A, "logs")]}]}],
        }
        expect(await decide(policies, "user:nikhil", "s3:PutObject", object(A, "logs", "report"))).toBe(false)
        expect(await decide(policies, "user:nikhil", "s3:GetObject", object(A, "docs", "report"))).toBe(true)
    })
    test("a resource policy granting an IAM role ARN is limited by an implicit deny in the role's boundary", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: [{on: bucket(A, "docs"), statements: [{effect: "allow", principals: ["role:demo"], actions: ["s3:GetObject"]}]}],
            boundaries: [{id: "demo", principals: ["role:demo"], allow: [{actions: ["ec2:*"]}]}],
        }
        expect(await decide(policies, "role:demo", "s3:GetObject", object(A, "docs", "report"))).toBe(false)
    })
    test("SCP ∩ boundary ∩ identity: the request is allowed only if all three allow", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: identity("user:shirley", [{actions: ["s3:*", "ec2:*"]}]),
            boundaries: [shirleyBoundary],
            guardrails: [{id: "scp", on: partition, principals: ["group:org-members"], ceiling: [{actions: ["ec2:*", "iam:*"]}]}],
        }
        expect(await decide(policies, "user:shirley", "ec2:StartInstances", instance(A, "i-1"))).toBe(true)
        expect(await decide(policies, "user:shirley", "s3:GetObject", object(A, "docs", "report"))).toBe(false)
    })
})

describe("session policies: https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#policies_session", () => {
    const demo = identity("role:demo", [{actions: ["s3:*", "ec2:*"]}])
    test("a role session's permissions are identity ∩ session policy", async () => {
        const policies = {resourcePolicies: demo}
        expect(await decide(policies, "role:demo", "s3:GetObject", object(A, "docs", "report"), {scopes: ["session-s3-read"]})).toBe(true)
        expect(await decide(policies, "role:demo", "s3:PutObject", object(A, "docs", "report"), {scopes: ["session-s3-read"]})).toBe(false)
        expect(await decide(policies, "role:demo", "ec2:StartInstances", instance(A, "i-1"), {scopes: ["session-s3-read"]})).toBe(false)
    })
    test("without a session policy the session has the role's identity permissions", async () => {
        expect(await decide({resourcePolicies: demo}, "role:demo", "s3:PutObject", object(A, "docs", "report"))).toBe(true)
    })
    test("a session policy can't grant more than the role's identity policy", async () => {
        expect(await decide({}, "role:demo", "s3:GetObject", object(A, "docs", "report"), {scopes: ["session-s3-read"]})).toBe(false)
    })
    test("session ∩ boundary ∩ identity", async () => {
        const policies: GGAuthzPolicies = {resourcePolicies: demo, boundaries: [{id: "demo", principals: ["role:demo"], allow: [{actions: ["ec2:*"]}]}]}
        expect(await decide(policies, "role:demo", "s3:GetObject", object(A, "docs", "report"), {scopes: ["session-s3-read", "session-ec2"]})).toBe(false)
        expect(await decide(policies, "role:demo", "ec2:StartInstances", instance(A, "i-1"), {scopes: ["session-s3-read", "session-ec2"]})).toBe(true)
    })
    // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html
    test("a resource policy granting the role ARN is limited by an implicit deny in the session policy", async () => {
        const policies: GGAuthzPolicies = {resourcePolicies: [{on: instance(A, "i-1"), statements: [{effect: "allow", principals: ["role:demo"], actions: ["ec2:StartInstances"]}]}]}
        expect(await decide(policies, "role:demo", "ec2:StartInstances", instance(A, "i-1"))).toBe(true)
        expect(await decide(policies, "role:demo", "ec2:StartInstances", instance(A, "i-1"), {scopes: ["session-s3-read"]})).toBe(false)
    })
})

describe("policy elements", () => {
    // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notprincipal.html
    test("Deny with NotPrincipal denies every principal except the listed ones", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: [
                ...identity("user:alice", [allS3]),
                ...identity("user:bob", [allS3]),
                {on: bucket(A, "docs"), statements: [{effect: "deny", principals: ["everyone"], except: ["user:alice"], actions: ["s3:*"]}]},
            ],
        }
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"))).toBe(true)
        expect(await decide(policies, "user:bob", "s3:GetObject", object(A, "docs", "report"))).toBe(false)
    })
    // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_action.html
    test("Action \"s3:*\" matches every action of the service and nothing else", async () => {
        const policies = {resourcePolicies: identity("user:alice", [allS3])}
        expect(await decide(policies, "user:alice", "s3:DeleteBucket", bucket(A, "docs"))).toBe(true)
        expect(await decide(policies, "user:alice", "ec2:StartInstances", instance(A, "i-1"))).toBe(false)
    })
    test("multiple values in Action are OR", async () => {
        const policies = {resourcePolicies: identity("user:alice", [{actions: ["s3:GetObject", "ec2:StartInstances"]}])}
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"))).toBe(true)
        expect(await decide(policies, "user:alice", "ec2:StartInstances", instance(A, "i-1"))).toBe(true)
        expect(await decide(policies, "user:alice", "ec2:TerminateInstances", instance(A, "i-1"))).toBe(false)
    })
    // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_resource.html
    test("Resource \"bucket/*\" matches every object in the bucket and not other buckets", async () => {
        const policies = {resourcePolicies: identity("user:alice", [{actions: ["s3:GetObject"], resources: [`${bucket(A, "docs")}/*`]}])}
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "secret"))).toBe(true)
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "logs", "report"))).toBe(false)
    })
    test("Resource \"*\" matches every resource", async () => {
        const policies = {resourcePolicies: identity("user:alice", [{actions: ["s3:GetObject"]}])}
        expect(await decide(policies, "user:alice", "s3:GetObject", object(B, "logs", "report"))).toBe(true)
    })
    test("multiple values in Resource are OR", async () => {
        const policies = {resourcePolicies: identity("user:alice", [{actions: ["s3:GetObject"], resources: [`${bucket(A, "docs")}/*`, `${bucket(A, "logs")}/*`]}])}
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "logs", "report"))).toBe(true)
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "shared", "report"))).toBe(false)
    })
    test("an ARN wildcard in the account segment matches every account", async () => {
        const policies = {resourcePolicies: identity("user:alice", [{actions: ["ec2:StartInstances"], resources: ["rn:aws:ec2:*"]}])}
        expect(await decide(policies, "user:alice", "ec2:StartInstances", instance(B, "i-1"))).toBe(true)
    })
    test("multiple statements in a policy are OR", async () => {
        const policies = {resourcePolicies: identity("user:alice", [{actions: ["s3:GetObject"]}, {actions: ["ec2:StartInstances"]}])}
        expect(await decide(policies, "user:alice", "ec2:StartInstances", instance(A, "i-1"))).toBe(true)
    })
})

describe("conditions (covered via caller-computed facts)", () => {
    // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notaction.html (MFA deny, with Action instead of NotAction)
    test("aws:MultiFactorAuthPresent: deny unless signed in with MFA", async () => {
        const policies = {resourcePolicies: identity("user:alice", [{actions: ["ec2:*"]}], [{actions: ["ec2:TerminateInstances"], unless: ["mfaPresent"]}])}
        expect(await decide(policies, "user:alice", "ec2:TerminateInstances", instance(A, "i-1"))).toBe(false)
        expect(await decide(policies, "user:alice", "ec2:TerminateInstances", instance(A, "i-1"), {context: {mfaPresent: true}})).toBe(true)
    })
    test.each([
        ["aws:SourceIp (https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html#condition-keys-sourceip)", "sourceIpInCorpRange"],
        ["aws:CurrentTime (https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html#condition-keys-currenttime)", "beforeExpiry"],
        ["ABAC: aws:PrincipalTag/project equals aws:ResourceTag/project (https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html#condition-keys-principaltag)", "principalProjectTagMatchesResource"],
        ["multiple values for one key are OR", "sourceVpcIsAOrB"],
        ["ForAllValues / ForAnyValue (https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-single-vs-multi-valued-context-keys.html)", "allRequestTagKeysAllowed"],
    ])("%s: allows only when true; a key missing from the request context is false", async (_, fact) => {
        const policies = {resourcePolicies: identity("user:alice", [{actions: ["s3:GetObject"], when: [fact]}])}
        const get = (context: Record<string, unknown>) => decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"), {context})
        expect(await get({[fact]: true})).toBe(true)
        expect(await get({[fact]: false})).toBe(false)
        expect(await get({})).toBe(false)
    })
    // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-logic-multiple-context-keys-or-values.html
    test("multiple condition operators or keys in one statement are AND", async () => {
        const policies = {resourcePolicies: identity("user:alice", [{actions: ["s3:GetObject"], when: ["sourceIpInCorpRange", "secureTransport"]}])}
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"), {context: {sourceIpInCorpRange: true}})).toBe(false)
        expect(await decide(policies, "user:alice", "s3:GetObject", object(A, "docs", "report"), {context: {sourceIpInCorpRange: true, secureTransport: true}})).toBe(true)
    })
    // https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_rcps.html
    test("conditions on SCPs and RCPs: deny outside approved regions", async () => {
        const policies: GGAuthzPolicies = {
            resourcePolicies: identity("user:alice", [{actions: ["ec2:*"]}]),
            guardrails: [{id: "scp-regions", on: partition, principals: ["group:org-members"], deny: [{actions: ["ec2:*"], unless: ["requestedRegionApproved"]}]}],
        }
        expect(await decide(policies, "user:alice", "ec2:StartInstances", instance(A, "i-1"))).toBe(false)
        expect(await decide(policies, "user:alice", "ec2:StartInstances", instance(A, "i-1"), {context: {requestedRegionApproved: true}})).toBe(true)
    })
})
