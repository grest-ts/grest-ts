import {defineAuthzModel, defineAuthzRole, defineAuthzService, defineAuthzTokenScope, type GGAuthzMemoryData, type GGAuthzPolicies} from "../src/index-node"
import type {World} from "./random"

export const rn = {
    org: "rn:acme:org:acme:org/acme",
    web: "rn:acme:org:acme:project/web",
    ml: "rn:acme:org:acme:project/ml",
    ws: (id: string) => `rn:acme:vm:acme:workspace/${id}`,
    wsSecret: (ws: string, id: string) => `rn:acme:secrets:acme:workspace/${ws}/secret/${id}`,
    secret: (id: string) => `rn:acme:secrets:acme:secret/${id}`,
    repo: (id: string) => `rn:acme:git:acme:repo/${id}`,
    cloud: (id: string) => `rn:acme:cloud:acme:provider/${id}`,
}

export const Vm = defineAuthzService("vm", {
    description: "Developer VMs",
    types: {workspace: "A developer's VM"},
    actions: {
        ReadWorkspace: {on: ["workspace"], description: "See a workspace and its state"},
        StartWorkspace: {on: ["workspace"]},
        StopWorkspace: {on: ["workspace"]},
        TakeOverWorkspace: {on: ["workspace"], description: "Attach to someone else's session"},
    },
})
export const Secrets = defineAuthzService("secrets", {
    types: {secret: "A secret value, project- or workspace-level"},
    actions: {Read: {on: ["secret"]}, Write: {on: ["secret"]}},
})
export const Git = defineAuthzService("git", {
    types: {repo: "A repository"},
    actions: {Read: {on: ["repo"]}, Push: {on: ["repo"]}},
})
export const Cloud = defineAuthzService("cloud", {
    types: {provider: "A compute provider"},
    actions: {Launch: {on: ["provider"], description: "Start a machine on the provider"}},
})
export const Org = defineAuthzService("org", {
    types: {org: "The organization", project: "A project"},
    actions: {ManageMembers: {on: ["org", "project"]}},
})

export const model = defineAuthzModel({
    partition: "acme",
    services: [Vm, Secrets, Git, Cloud, Org],
    roles: [
        defineAuthzRole("viewer", {actions: [Vm.ReadWorkspace, Git.Read], description: "Read-only"}),
        defineAuthzRole("member", {actions: [Vm.ReadWorkspace, Vm.StartWorkspace, Vm.StopWorkspace, Git.all]}),
        defineAuthzRole("owner", {actions: [Vm.ReadWorkspace, Vm.StartWorkspace, Vm.StopWorkspace, Secrets.all]}),
        defineAuthzRole("admin", {actions: [Vm.all, Secrets.all, Git.all, Cloud.all, Org.all]}),
        defineAuthzRole("gpu-launcher", {actions: [Cloud.Launch]}),
        defineAuthzRole("launcher", {actions: [Cloud.Launch]}),
        defineAuthzRole("secret-reader", {actions: [Secrets.Read]}),
    ],
    tokenScopes: [
        defineAuthzTokenScope("workspaces:read", {allow: [{actions: [Vm.ReadWorkspace]}]}),
        defineAuthzTokenScope("workspaces:operate", {allow: [{actions: [Vm.StartWorkspace, Vm.StopWorkspace], resources: ["rn:acme:vm:acme:workspace/*"]}]}),
        defineAuthzTokenScope("repos", {allow: [{actions: [Git.Read], when: ["repoVisible"]}]}),
    ],
    workloadTypes: ["agent"],
    approvalFloor: [{actions: [Secrets.Write], level: "ask"}],
    stepUpFacts: ["mfa"],
})

export const policies: GGAuthzPolicies = {
    bindings: [
        {principal: "group:admins", role: "admin", on: rn.org},
        {principal: "group:eng", role: "member", on: rn.web},
        {principal: "group:ml", role: "member", on: rn.ml},
        {principal: "user:ann", role: "owner", on: rn.ws("ann-1")},
        {principal: "user:ben", role: "owner", on: rn.ws("ben-1")},
        {principal: "user:dan", role: "owner", on: rn.ws("dan-1")},
        {principal: "everyone", role: "launcher", on: rn.cloud("basic")},
        {principal: "group:gpu-users", role: "gpu-launcher", on: rn.cloud("gpu")},
        {principal: "group:ml", role: "launcher", on: rn.cloud("ml-gpu")},
        {principal: "everyone", role: "viewer", on: rn.repo("site"), when: ["repoVisible"]},
        {principal: "agent:release-bot", role: "secret-reader", on: rn.web},
    ],
    resourcePolicies: [
        {
            on: rn.secret("release-key"),
            statements: [
                {sid: "ben-reads-release-key", effect: "allow", principals: ["user:ben"], actions: ["secrets:Read"]},
                {sid: "release-key-only", effect: "deny", principals: ["everyone"], except: ["user:ben", "group:admins", "agent:*"], actions: ["secrets:*"]},
            ],
            approvals: [{actions: ["secrets:Read"], level: "ask"}],
        },
        {on: rn.web, approvals: [{actions: ["secrets:*"], level: "ask", locked: true}]},
        {on: rn.secret("db-pass"), approvals: [{actions: ["secrets:Read"], level: "auto"}]},
        {on: rn.secret("signing"), approvals: [{actions: ["secrets:*"], level: "critical"}]},
        {on: rn.org, approvals: [{actions: ["vm:*"], level: "ask-once"}, {actions: ["org:*"], level: "humans-only"}, {actions: ["cloud:*"], level: "humans-only"}]},
        {on: rn.ml, approvals: [{actions: ["vm:*"], level: "auto"}, {actions: ["cloud:*"], level: "ask"}]},
        {on: rn.ws("ann-1"), approvals: [{actions: ["vm:TakeOverWorkspace"], level: "humans-only", locked: true}]},
        {
            on: rn.repo("site"),
            statements: [{sid: "pushers", effect: "allow", principals: ["group:eng"], actions: ["git:Push"], unless: ["frozen"]}],
        },
        {
            on: rn.ws("cleo-1"),
            statements: [{sid: "pair", effect: "allow", principals: ["user:ann"], actions: ["vm:ReadWorkspace", "vm:StartWorkspace"]}],
        },
    ],
    boundaries: [
        {
            id: "agents",
            principals: ["agent:*"],
            allow: [
                {actions: ["vm:*"], resources: ["rn:acme:vm:acme:workspace/*"]},
                {actions: ["secrets:Read"]},
                {actions: ["secrets:Write"], resources: ["rn:acme:secrets:acme:workspace/*"]},
                {actions: ["cloud:Launch"]},
                {actions: ["git:Read", "git:Push"], when: ["repoVisible"]},
            ],
        },
        {id: "release-bot", principals: ["agent:release-bot"], allow: [{actions: ["secrets:Read"], resources: [rn.web]}]},
    ],
    guardrails: [
        {
            id: "contractors-no-paid",
            on: rn.org,
            principals: ["group:contractors"],
            deny: [{actions: ["cloud:Launch"], resources: [rn.cloud("gpu")]}, {actions: ["secrets:*"], resources: ["rn:acme:secrets:acme:secret/*"]}],
        },
        {id: "secrets-need-mfa", on: rn.org, except: ["agent:*"], deny: [{actions: ["secrets:Write"], unless: ["mfa"]}]},
        {id: "ml-sandbox", on: rn.ml, ceiling: [{actions: ["vm:*", "git:*", "secrets:Read", "org:ManageMembers", "cloud:Launch"]}, {actions: ["secrets:Write"], when: ["mfa"]}]},
    ],
}

const memberships: Record<string, string[]> = {
    "user:ann": ["group:eng"],
    "user:ben": ["group:eng", "group:gpu-users"],
    "user:cleo": ["group:admins", "group:ml"],
    "user:dan": ["group:contractors", "group:gpu-users", "group:ml"],
    "user:eve": [],
}

const parents: Record<string, string> = {
    [rn.web]: rn.org,
    [rn.ml]: rn.org,
    [rn.cloud("basic")]: rn.org,
    [rn.cloud("gpu")]: rn.org,
    [rn.cloud("ml-gpu")]: rn.ml,
    [rn.repo("site")]: rn.web,
    [rn.repo("models")]: rn.ml,
    [rn.secret("release-key")]: rn.web,
    [rn.secret("db-pass")]: rn.web,
    [rn.secret("signing")]: rn.web,
    [rn.secret("ml-token")]: rn.ml,
}
for (const [ws, project] of [["ann-1", rn.web], ["ben-1", rn.web], ["cleo-1", rn.ml], ["dan-1", rn.ml]] as const) {
    parents[rn.ws(ws)] = project
    parents[rn.wsSecret(ws, "env")] = rn.ws(ws)
}

export const data: GGAuthzMemoryData = {parents, groups: memberships}

export const users = Object.keys(memberships)
export const agents = ["agent:ws-ann", "agent:ws-ben", "agent:release-bot"]
const clients = ["client:ci-tool"]
const resources = [rn.org, ...Object.keys(parents)]
const facts = ["mfa", "repoVisible", "frozen"]

export const world: World = {model, policies, data, principals: [...users, ...agents, ...clients], resources, facts}
