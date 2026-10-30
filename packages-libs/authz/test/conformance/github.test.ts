import {describe, expect, test} from "vitest"
import {GGAuthz, GGAuthzMemoryResolver, type GGAuthzModel, type GGAuthzPolicies} from "../../src/index-node"
import {req} from "../util"

const ent = "rn:gh:org:ent:enterprise/ent"
const acme = "rn:gh:org:ent:org/acme"
const beta = "rn:gh:org:ent:org/beta"
const repo = (id: string) => `rn:gh:repo:ent:repo/${id}`
const branch = (r: string, b: string) => `${repo(r)}/branch/${b}`

const R = {
    Read: "repo:Read", OpenIssue: "repo:OpenIssue", Fork: "repo:Fork",
    Label: "repo:Label",
    Push: "repo:Push", ForcePush: "repo:ForcePush",
    EditTopics: "repo:EditTopics",
    ManageAccess: "repo:ManageAccess", InviteCollaborator: "repo:InviteCollaborator", ChangeVisibility: "repo:ChangeVisibility", Delete: "repo:Delete", ManageWebhooks: "repo:ManageWebhooks",
    ViewSecurityAlerts: "repo:ViewSecurityAlerts", HideComment: "repo:HideComment",
}
const read = [R.Read, R.OpenIssue, R.Fork]
const triage = [...read, R.Label]
const write = [...triage, R.Push, R.ForcePush]
const maintain = [...write, R.EditTopics]
const admin = [...maintain, R.ManageAccess, R.InviteCollaborator, R.ChangeVisibility, R.Delete, R.ManageWebhooks, R.ViewSecurityAlerts]

const onRepo = ["repo:repo"]
const onBoth = ["repo:repo", "repo:branch"]
const model: GGAuthzModel = {
    partition: "gh",
    actions: [
        ...[R.Read, R.Push].map(name => ({name, resourceTypes: onBoth})),
        {name: R.ForcePush, resourceTypes: ["repo:branch"]},
        ...[R.OpenIssue, R.Fork, R.Label, R.EditTopics, R.ManageAccess, R.InviteCollaborator, R.ChangeVisibility, R.Delete, R.ManageWebhooks, R.ViewSecurityAlerts, R.HideComment]
            .map(name => ({name, resourceTypes: onRepo})),
        {name: "org:SetBasePermission", resourceTypes: ["org:org"]},
        {name: "org:ManageBilling", resourceTypes: ["org:org"]},
    ],
    roles: [
        {name: "read", actions: read},
        {name: "triage", actions: triage},
        {name: "write", actions: write},
        {name: "maintain", actions: maintain},
        {name: "admin", actions: admin},
        {name: "write-plus-webhooks", actions: [...write, R.ManageWebhooks]},
        {name: "org-owner", actions: ["repo:*", "org:*"]},
        {name: "enterprise-owner", actions: ["org:*"]},
        {name: "security-manager", actions: [...read, R.ViewSecurityAlerts]},
        {name: "webhook-manager", actions: [R.ManageWebhooks]},
        {name: "moderator", actions: [R.HideComment]},
        {name: "billing-manager", actions: ["org:ManageBilling"]},
        {name: "app-ci", actions: [R.Read, R.Push, R.OpenIssue]},
    ],
    tokenScopes: [
        {name: "contents:read", allow: [{actions: [R.Read]}]},
        {name: "contents:write", allow: [{actions: [R.Read, R.Push]}]},
        {name: "issues:write", allow: [{actions: [R.OpenIssue, R.Label]}]},
        {name: "public:read", allow: [{actions: [R.Read], when: ["repoPublic"]}]},
    ],
    workloadTypes: [],
}

const parents: Record<string, string> = {
    [acme]: ent,
    [beta]: ent,
    [repo("site")]: acme,
    [repo("api")]: acme,
    [repo("web")]: acme,
    [repo("oss")]: acme,
    [repo("old")]: acme,
    [repo("roles")]: acme,
    [repo("secret")]: beta,
    [repo("handbook")]: beta,
}
for (const b of ["main", "dev"]) {
    parents[branch("site", b)] = repo("site")
    parents[branch("web", b)] = repo("web")
}

const acmeMember = ["group:acme-members", "group:ent-members"]
// Child team members are returned with their parent teams: the resolver flattens nesting.
const groups: Record<string, string[]> = {
    "user:octo": ["group:acme-owners", ...acmeMember],
    "user:web": ["group:team-eng-web", "group:team-eng", ...acmeMember],
    "user:lead": ["group:team-eng", ...acmeMember],
    "user:plain": acmeMember,
    "user:rel": ["group:team-release", ...acmeMember],
    "user:sec": ["group:team-sec", ...acmeMember],
    "user:hooks": ["group:team-hooks", ...acmeMember],
    "user:mod": ["group:acme-moderators", ...acmeMember],
    "user:custom": acmeMember,
    "user:betty": ["group:beta-members", "group:ent-members"],
    "user:boss": ["group:ent-owners"],
}

const policies: GGAuthzPolicies = {
    bindings: [
        {principal: "group:acme-owners", role: "org-owner", on: acme},
        {principal: "group:acme-members", role: "read", on: acme},
        {principal: "group:ent-owners", role: "enterprise-owner", on: ent},
        {principal: "group:team-eng", role: "write", on: repo("site")},
        {principal: "group:team-eng-web", role: "maintain", on: repo("web")},
        {principal: "group:team-release", role: "write", on: repo("site")},
        {principal: "group:team-sec", role: "security-manager", on: acme},
        {principal: "group:team-hooks", role: "webhook-manager", on: acme},
        {principal: "group:acme-moderators", role: "moderator", on: acme, when: ["repoPublic"]},
        {principal: "user:billing", role: "billing-manager", on: acme},
        {principal: "user:custom", role: "write-plus-webhooks", on: repo("api")},
        {principal: "user:contractor", role: "triage", on: repo("site")},
        ...["read", "triage", "write", "maintain", "admin"].map(role => ({principal: `user:${role}-holder`, role, on: repo("roles")})),
        {principal: "everyone", role: "read", on: repo("oss"), when: ["repoPublic"]},
        {principal: "group:ent-members", role: "read", on: repo("handbook")},
        {principal: "app:ci", role: "app-ci", on: acme},
        {principal: "app:deployer", role: "write", on: repo("site")},
    ],
    resourcePolicies: [
        {
            on: branch("site", "main"),
            statements: [
                {sid: "ruleset-restrict-updates", effect: "deny", principals: ["everyone"], except: ["group:team-release", "app:deployer"], actions: [R.Push, R.ForcePush]},
                {sid: "ruleset-block-force-push", effect: "deny", principals: ["everyone"], actions: [R.ForcePush]},
            ],
        },
        {on: acme, statements: [{sid: "org-ruleset-default-branch", effect: "deny", principals: ["everyone"], actions: [R.ForcePush], when: ["defaultBranch"]}]},
    ],
    boundaries: [
        {id: "pat-web-site", principals: ["pat:web-site"], allow: [{actions: [R.Read, R.Push], resources: [repo("site")]}, {actions: [R.Read], when: ["repoPublic"]}]},
        {id: "pat-plain-site", principals: ["pat:plain-site"], allow: [{actions: [R.Read, R.Push], resources: [repo("site")]}]},
        {id: "pat-web-acme", principals: ["pat:web-acme"], allow: [{actions: ["repo:*"], resources: [acme]}]},
        {id: "app-ci", principals: ["app:ci"], allow: [{actions: [R.Read, R.Push, R.OpenIssue], resources: [acme]}]},
    ],
    guardrails: [
        {id: "enforced-base-permission", on: ent, except: ["group:ent-owners"], deny: [{actions: ["org:SetBasePermission"]}]},
        {id: "visibility-change-owners-only", on: ent, except: ["group:acme-owners", "group:beta-owners"], deny: [{actions: [R.ChangeVisibility]}]},
        {id: "delete-owners-only", on: ent, except: ["group:acme-owners", "group:beta-owners"], deny: [{actions: [R.Delete]}]},
        {id: "no-private-forks", on: ent, deny: [{actions: [R.Fork], unless: ["repoPublic"]}]},
        {id: "archived-read-only", on: ent, deny: [{actions: [R.Push, R.ForcePush, R.Label, R.OpenIssue, R.EditTopics, R.ManageWebhooks], when: ["repoArchived"]}]},
        {id: "invite-owners-only", on: acme, except: ["group:acme-owners"], deny: [{actions: [R.InviteCollaborator]}]},
        {id: "pat-needs-approval", on: acme, principals: ["pat:*"], deny: [{actions: ["repo:*"], unless: ["patApproved", "repoPublic"]}]},
        {id: "no-classic-pats", on: acme, principals: ["classic-pat:*"], deny: [{actions: ["repo:*"]}]},
    ],
}

const authz = new GGAuthz({model, policies, resolver: new GGAuthzMemoryResolver({parents, groups})})
// The caller knows the repository's state; an unstated fact would be unknown, and an unknown fact makes a deny apply.
const known = {repoPublic: false, repoArchived: false, defaultBranch: false, patApproved: false}

async function may(subject: string, action: string, resource: string, extra: {for?: string, scopes?: string[], context?: Record<string, unknown>} = {}): Promise<boolean> {
    return (await authz.evaluate(req(subject, action, resource, {...extra, context: {...known, ...extra.context}}))).decision
}

const pub = {context: {repoPublic: true}}

describe("https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization", () => {
    test("read can pull, open issues and fork, but not label", async () => {
        expect(await Promise.all([R.Read, R.OpenIssue].map(a => may("user:read-holder", a, repo("roles"))))).toEqual([true, true])
        expect(await may("user:read-holder", R.Label, repo("roles"))).toBe(false)
    })
    test("triage adds labelling but not pushing", async () => {
        expect(await may("user:triage-holder", R.Label, repo("roles"))).toBe(true)
        expect(await may("user:triage-holder", R.Push, repo("roles"))).toBe(false)
    })
    test("write adds pushing but not repository settings", async () => {
        expect(await may("user:write-holder", R.Push, repo("roles"))).toBe(true)
        expect(await may("user:write-holder", R.EditTopics, repo("roles"))).toBe(false)
    })
    test("maintain adds topics but not access management or deletion", async () => {
        expect(await may("user:maintain-holder", R.EditTopics, repo("roles"))).toBe(true)
        expect(await may("user:maintain-holder", R.ManageAccess, repo("roles"))).toBe(false)
        expect(await may("user:maintain-holder", R.Delete, repo("roles"))).toBe(false)
    })
    test("admin manages collaborator and team access", async () => {
        expect(await may("user:admin-holder", R.ManageAccess, repo("roles"))).toBe(true)
    })
    test("organization owners have admin access to every repository of the organization", async () => {
        for (const r of ["site", "api", "roles"]) expect(await may("user:octo", R.ManageAccess, repo(r))).toBe(true)
        expect(await may("user:octo", R.Read, repo("secret"))).toBe(false)
    })
})

describe("https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/setting-base-permissions-for-an-organization", () => {
    test("base permission applies to all members on every organization repository", async () => {
        for (const r of ["site", "api", "roles"]) expect(await may("user:plain", R.Read, repo(r))).toBe(true)
        expect(await may("user:plain", R.Push, repo("site"))).toBe(false)
    })
    test("base permissions do not apply to outside collaborators", async () => {
        expect(await may("user:contractor", R.Label, repo("site"))).toBe(true)
        expect(await may("user:contractor", R.Read, repo("api"))).toBe(false)
    })
    test("a higher grant overrides the base permission", async () => {
        expect(await may("user:web", R.EditTopics, repo("web"))).toBe(true)
    })
    test("with no base permission a member without other access cannot see a private repository", async () => {
        expect(await may("user:betty", R.Read, repo("secret"))).toBe(false)
    })
})

describe("https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/about-custom-repository-roles", () => {
    test("a custom role keeps its inherited role and adds permissions", async () => {
        expect(await may("user:custom", R.Push, repo("api"))).toBe(true)
        expect(await may("user:custom", R.ManageWebhooks, repo("api"))).toBe(true)
        expect(await may("user:custom", R.ManageAccess, repo("api"))).toBe(false)
    })
    test("access from several sources is additive", async () => {
        expect(await may("user:web", R.Push, repo("site"))).toBe(true)
        expect(await may("user:web", R.EditTopics, repo("web"))).toBe(true)
        expect(await may("user:web", R.Read, repo("api"))).toBe(true)
    })
})

describe("https://docs.github.com/en/organizations/organizing-members-into-teams/about-teams", () => {
    test("child teams inherit the parent team's access", async () => {
        expect(await may("user:web", R.Push, repo("site"))).toBe(true)
    })
    test("a parent team member does not get the child team's access", async () => {
        expect(await may("user:lead", R.Push, repo("site"))).toBe(true)
        expect(await may("user:lead", R.EditTopics, repo("web"))).toBe(false)
    })
})

describe("https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/roles-in-an-organization", () => {
    test("security managers can read all repositories and view security alerts", async () => {
        expect(await may("user:sec", R.ViewSecurityAlerts, repo("api"))).toBe(true)
        expect(await may("user:plain", R.ViewSecurityAlerts, repo("api"))).toBe(false)
    })
    test("moderators can hide comments in public repositories only (covered via caller-computed fact)", async () => {
        expect(await may("user:mod", R.HideComment, repo("oss"), pub)).toBe(true)
        expect(await may("user:mod", R.HideComment, repo("site"))).toBe(false)
    })
    test("billing managers manage billing without access to repositories", async () => {
        expect(await may("user:billing", "org:ManageBilling", acme)).toBe(true)
        expect(await may("user:billing", R.Read, repo("site"))).toBe(false)
    })
    test("an organization role assigned to a team applies to every repository of the organization", async () => {
        for (const r of ["site", "api"]) expect(await may("user:hooks", R.ManageWebhooks, repo(r))).toBe(true)
    })
})

describe("https://docs.github.com/en/enterprise-cloud@latest/repositories/creating-and-managing-repositories/about-repositories", () => {
    test("public repositories are readable by everyone (covered via caller-computed fact)", async () => {
        expect(await may("anonymous:visitor", R.Read, repo("oss"), pub)).toBe(true)
        expect(await may("anonymous:visitor", R.Push, repo("oss"), pub)).toBe(false)
    })
    test("private repositories are readable only by people given access", async () => {
        expect(await may("user:stranger", R.Read, repo("site"))).toBe(false)
    })
    test("organization members can read internal repositories of any organization in the enterprise", async () => {
        expect(await may("user:plain", R.Read, repo("handbook"))).toBe(true)
        expect(await may("user:betty", R.Read, repo("handbook"))).toBe(true)
    })
    test("internal repositories are not visible to outside collaborators", async () => {
        expect(await may("user:contractor", R.Read, repo("handbook"))).toBe(false)
    })
})

describe("https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets", () => {
    test("only the bypass list (teams and apps) may push to a branch the ruleset restricts", async () => {
        expect(await may("user:rel", R.Push, branch("site", "main"))).toBe(true)
        expect(await may("app:deployer", R.Push, branch("site", "main"))).toBe(true)
        expect(await may("user:web", R.Push, branch("site", "main"))).toBe(false)
        expect(await may("user:web", R.Push, branch("site", "dev"))).toBe(true)
    })
    test("repository admins not on the bypass list are blocked", async () => {
        expect(await may("user:octo", R.Push, branch("site", "main"))).toBe(false)
    })
    test("a bypass does not grant access the actor lacks", async () => {
        expect(await may("user:plain", R.Push, branch("site", "main"))).toBe(false)
    })
    test("rules from several rulesets aggregate and the most restrictive applies", async () => {
        expect(await may("user:rel", R.ForcePush, branch("site", "main"))).toBe(false)
    })
    test("an organization ruleset applies to every repository of the organization (covered via caller-computed fact)", async () => {
        expect(await may("user:web", R.ForcePush, branch("web", "main"), {context: {defaultBranch: true}})).toBe(false)
        expect(await may("user:web", R.ForcePush, branch("web", "dev"))).toBe(true)
    })
})

describe("https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-repository-management-policies-in-your-enterprise", () => {
    test("an enforced base permission policy cannot be changed by organization owners", async () => {
        expect(await may("user:octo", "org:SetBasePermission", acme)).toBe(false)
        expect(await may("user:boss", "org:SetBasePermission", acme)).toBe(true)
    })
    test("visibility changes can be limited to organization owners", async () => {
        expect(await may("user:admin-holder", R.ChangeVisibility, repo("roles"))).toBe(false)
        expect(await may("user:octo", R.ChangeVisibility, repo("roles"))).toBe(true)
    })
    test("repository deletion can be restricted to organization owners", async () => {
        expect(await may("user:admin-holder", R.Delete, repo("roles"))).toBe(false)
        expect(await may("user:octo", R.Delete, repo("roles"))).toBe(true)
    })
    test("forking of private repositories can be disallowed (covered via caller-computed fact)", async () => {
        expect(await may("user:plain", R.Fork, repo("site"))).toBe(false)
        expect(await may("user:stranger", R.Fork, repo("oss"), pub)).toBe(true)
    })
})

describe("https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-outside-collaborators/adding-outside-collaborators-to-repositories-in-your-organization", () => {
    test("inviting outside collaborators can be restricted to organization owners", async () => {
        expect(await may("user:admin-holder", R.InviteCollaborator, repo("roles"))).toBe(false)
        expect(await may("user:octo", R.InviteCollaborator, repo("roles"))).toBe(true)
    })
})

describe("https://docs.github.com/en/repositories/archiving-a-github-repository/archiving-repositories", () => {
    test("an archived repository is read-only for all users, owners included (covered via caller-computed fact)", async () => {
        const archived = {context: {repoArchived: true}}
        expect(await may("user:octo", R.Push, repo("old"), archived)).toBe(false)
        expect(await may("user:octo", R.Read, repo("old"), archived)).toBe(true)
    })
})

describe("https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens", () => {
    const approved = {patApproved: true}
    const pat = (user: string, scopes: string[], context: Record<string, unknown> = approved) => ({for: user, scopes, context})
    test("a fine-grained token is limited to its selected repositories", async () => {
        expect(await may("pat:web-site", R.Push, repo("site"), pat("user:web", ["contents:write"]))).toBe(true)
        expect(await may("pat:web-site", R.Read, repo("api"), pat("user:web", ["contents:write"]))).toBe(false)
    })
    test("a fine-grained token is limited to its permissions", async () => {
        expect(await may("pat:web-site", R.Push, repo("site"), pat("user:web", ["contents:read"]))).toBe(false)
        expect(await may("pat:web-site", R.Read, repo("site"), pat("user:web", ["contents:read"]))).toBe(true)
    })
    test("a token cannot grant additional access to its user", async () => {
        expect(await may("pat:plain-site", R.Push, repo("site"), pat("user:plain", ["contents:write"]))).toBe(false)
    })
    test("a token always includes read access to public repositories (covered via caller-computed fact)", async () => {
        expect(await may("pat:web-site", R.Read, repo("oss"), pat("user:web", ["issues:write", "public:read"], {repoPublic: true}))).toBe(true)
    })
    test("a token is limited to resources of a single owner", async () => {
        expect(await may("pat:web-acme", R.Read, repo("site"), pat("user:web", ["contents:read"]))).toBe(true)
        expect(await may("user:web", R.Read, repo("handbook"))).toBe(true)
        expect(await may("pat:web-acme", R.Read, repo("handbook"), pat("user:web", ["contents:read"]))).toBe(false)
    })
    test("a token pending organization approval cannot access private organization resources (covered via caller-computed fact)", async () => {
        expect(await may("pat:web-site", R.Read, repo("site"), pat("user:web", ["contents:read"], {}))).toBe(false)
    })
    test("an organization can restrict classic tokens", async () => {
        expect(await may("classic-pat:web", R.Read, repo("site"), {for: "user:web"})).toBe(false)
        expect(await may("user:web", R.Read, repo("site"))).toBe(true)
    })
})

describe("https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app", () => {
    test("an installation token depends only on the app's permissions", async () => {
        expect(await may("app:ci", R.Push, repo("api"))).toBe(true)
        expect(await may("app:ci", R.EditTopics, repo("api"))).toBe(false)
    })
    test("a user access token is limited by the user's permissions", async () => {
        expect(await may("app:ci", R.Read, repo("site"), {for: "user:plain"})).toBe(true)
        expect(await may("app:ci", R.Push, repo("site"), {for: "user:plain"})).toBe(false)
        expect(await may("app:ci", R.Push, repo("site"), {for: "user:web"})).toBe(true)
    })
    test("a user access token is limited by the app's permissions", async () => {
        expect(await may("user:octo", R.EditTopics, repo("site"))).toBe(true)
        expect(await may("app:ci", R.EditTopics, repo("site"), {for: "user:octo"})).toBe(false)
    })
})

describe("https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user", () => {
    test("a user access token only reaches accounts where the app is installed", async () => {
        expect(await may("user:betty", R.Read, repo("handbook"))).toBe(true)
        expect(await may("app:ci", R.Read, repo("handbook"), {for: "user:betty"})).toBe(false)
    })
})
