<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/authz

Authorization for **hierarchical resources**: who may do what, on which resource, and whether an AI
agent needs a human to approve it first. Contracts declare what each method needs; an authority
decides it before the handler runs; every decision says *why*.

The engine is **pure**: no server, no storage. The **model** (services, actions, roles) is code,
declared once and shared with the browser. The **policies** (bindings, resource policies,
boundaries, guardrails) are per-tenant data you load from wherever you keep them. You pass both in
with a resolver for the scope tree and group memberships, and get decisions back.

```
  api package (shared, browser-safe)              per tenant (data)
  ┌──────────────────────────────────────┐        ┌───────────────────────────────────┐
  │ defineAuthzService("docs", {...})    │        │ bindings, resource policies,      │
  │ defineAuthzRole / defineAuthzModel   │        │ boundaries, guardrails            │
  │ permission: Docs.Write.on("docId")   │        │ resolver: ancestors, groups, attrs│
  └──────────────────┬───────────────────┘        └─────────────────┬─────────────────┘
                     └──────▶ new GGAuthz({model, policies, resolver}) ◀┘
                                         │
             server: GGAuthzAuthority decides each requirement before the handler,
                     authority.assert(...) for checks the handler makes itself,
                     authz.listAllowed(...) → a query plan for listings
```

```
effective access  =  grants  ∩  every cap that applies  −  hard noes
```

## Vocabulary

The examples use a document platform: tenant `acme` → project → folder → doc.

**Who, what, where**

| Term | Means | Example |
|---|---|---|
| principal | who acts: a user, a group, an AI agent, an app | `user:ann`, `group:eng`, `agent:assistant-ann` |
| workload | a principal that isn't a person; the model's `workloadTypes` say which types | `agent`, `client` |
| subject | the principal making this request, plus who it acts for (`onBehalfOf`) and through (`via`) | an app acting for ann through her assistant |
| resource | one thing, named by an RN | `rn:acme:docs:acme:doc/intro` |
| resource type | the kind of thing | `docs:doc` |
| scope tree | each resource's parents (`ancestors`); access given on a resource reaches everything below it | acme → project web → folder handbook → doc intro |
| action | one verb on one or more resource types | `docs:Write` |
| model | the services, actions, roles and token scopes; code, shared with the browser | `AppAuthz` |
| policies | who gets what in one tenant; data | bindings, guardrails, … |

**What gives access**

| Term | Means | Example |
|---|---|---|
| role | a named list of actions; only adds | `editor` = Write + Delete + everything in `viewer` |
| binding | principal + role + `on` a resource: the grant. Reaches `on` and everything below it | `group:eng` is `editor` on project web |
| resource policy | allow and deny statements kept on a resource | doc salaries: ben may read |
| condition | an attribute test a binding or rule must pass | `resource.owner` equals `principal.key`: "your own docs" |
| fact | a yes/no your code computes per request; `when` needs it true, `unless` needs it false | `published`, `mfa` |

**What takes access away**

| Term | Means | Example |
|---|---|---|
| deny statement | in a resource policy: nobody it selects may, whatever they were granted; `except` lists who is exempt | doc salaries: nobody except ben and admins |
| guardrail | a limit on everything under `on`, admins included: `deny` rules, a `ceiling`, or both | contractors may not export anywhere in acme |
| ceiling | nothing outside these rules is possible | project legal: only Read and Write |
| boundary | the most the principals it selects may ever do, whatever they're granted | assistants may only read and write inside folders |
| token scope | the most a token may do; the request's `scopes` | a `docs:read` token |
| restriction | the most this one request may do | only doc onboarding |

**Approvals**

| Term | Means | Example |
|---|---|---|
| approval level | whether a person must confirm a workload's allowed request: `auto` < `ask-once` < `ask` < `critical` < `humans-only` | an assistant reading salaries: `ask` |
| approval floor | a level the model always enforces | exporting always asks |
| locked | a level that resources below can't lower | |

**How one request is decided**

1. A deny statement or guardrail deny matches → **no**.
2. A ceiling, boundary, token scope or restriction doesn't cover it → **no**.
3. A binding or allow statement matches → **yes**.
4. For workloads: the approval level is attached, or `humans-only` → **no**.

Nothing matched → **no**.

Beyond that:

- **approvals for agents**: allowed, but a human confirms first;
- **delegation chains**: an outside client calling through your own agent, with every caller's caps;
- **list plans**: "which rows may I see" as a filter for your query, not a loop of checks;
- **remedies**: a denial says when another OAuth scope or an MFA step-up would turn it into an allow;
- unknown facts and attributes **fail closed in both directions**.

[Conformance](./README-conformance.md) compares the engine rule by rule with other authorization
systems.

The examples below use users `ann`, `ben`, `cleo` (admin) and `dan` (contractor), AI assistants
acting for users, and OAuth clients.

---

## 1. The model — once, in your api package

```ts
// api/authz/model.ts
import {defineAuthzModel, defineAuthzRole, defineAuthzService, defineAuthzTokenScope} from "@grest-ts/authz"

export const Org = defineAuthzService("org", {
    types: {org: "The tenant", project: "A group of folders"},
    actions: {ManageAccess: {on: ["org", "project"], description: "Grant and revoke roles"}},
})

export const Docs = defineAuthzService("docs", {
    types: {folder: "A folder of documents", doc: "A document"},
    actions: {
        Read: {on: ["doc"], description: "Open a document"},
        Write: {on: ["doc", "folder"], description: "Edit a document, or add one to a folder"},
        Delete: {on: ["doc"]},
        Export: {on: ["doc"]},
    },
})

Docs.Delete         // {name: "docs:Delete", resourceTypes: ["docs:doc"]}
Docs.types.folder   // "docs:folder"
Docs.all            // "docs:*"

const viewer = defineAuthzRole("viewer", {actions: [Docs.Read], description: "Read-only"})

export const AppAuthz = defineAuthzModel({
    partition: "acme",
    services: [Org, Docs],
    roles: [
        viewer,
        defineAuthzRole("editor", {actions: [Docs.Write, Docs.Delete], includes: [viewer]}),
        defineAuthzRole("admin", {actions: [Org.all, Docs.all]}),
    ],
    tokenScopes: [defineAuthzTokenScope("docs:read", {allow: [{actions: [Docs.Read]}]})],
    workloadTypes: ["agent", "client"],
    approvalFloor: [{actions: [Docs.Export], level: "ask"}],
    stepUpFacts: ["mfa"],
    grantAction: Org.ManageAccess,
})
```

- **Creating things.** Check a create on the parent: `Docs.Write` applies to a folder too. An
  action's `on` may also name another service's type as `service:type`; the model fails if no
  service declares it.
- **Fail at load.** `defineAuthzModel` validates the model and every action it names, then
  deep-freezes it.
- **Registry.** Services, roles and token scopes register globally with where they were defined.
  The same name defined in two places throws and names both; re-evaluating the same definition
  (HMR, vitest projects) replaces it.
- `workloadTypes` lists the principal types approvals apply to (none by default); a model with an
  `approvalFloor` but no workload types fails at load.

### Resource names (RN)

```
rn:<partition>:<service>:<tenant>:<type>/<id>[/<subtype>/<id>...]

rn:acme:docs:acme:doc/onboarding
rn:acme:docs:acme:folder/handbook/doc/intro
```

- **Only immutable parts.** The parent is an edge in the scope tree, not part of the name, so moving
  a doc to another folder doesn't rename it.
- `model.partition` is yours to choose; requests for another partition are denied.
- The **resource type** is `<service>:<last type>`, e.g. `docs:doc`.
- Helpers: `GGAuthzRn.parse`, `.format`, `.type`.
- **Matchers.** A plain RN means *this resource and everything under it*. `=rn:…` means *that
  resource only*. A pattern ending in `/*` or `:*` is a string prefix and must end at a segment
  boundary (`doc/d1*` is rejected: it would match `d10`). Prefix patterns are the **only** string
  matching in the engine.

### Principals

A principal is `<type>:<id>`: `user:ann`, `group:eng`, `agent:assistant-ann`, `client:ci-tool`.
Policy selectors: a principal or group (`user:ann`, `group:eng`), every principal of a type
(`agent:*`, a type check, not string matching), or `everyone`. Allows are the union over the
principal and its groups.

---

## 2. Contracts — declare what each method needs

An action builds a grest-ts `GGRequirement` for a contract method's `permission:`. It is plain data,
so contracts stay browser-safe:

```ts
delete: {input: IsObject({docId: IsDocId}), permission: Docs.Delete.on("docId")}
invite: {input: IsInvite,                    permission: Org.ManageAccess.on(Org.types.org)}    // the caller's tenant
list:   {                                    permission: Docs.Read.list()}
save:   {input: IsSaveDoc,                   permission: Docs.Write.on(Docs.types.doc, "docId").orCreateOn(Docs.types.folder, "folderId")}
mine:   {                                    permission: Docs.Read.onContext("currentDoc")}
```

| Builder | |
|---|---|
| `.on(field)` | the id is that input field; the action must have one resource type. Checked against the input at compile time and when the contract is built |
| `.on(type, field)` | for an action on several types; `type` must be one of them |
| `.on(tenantType)` | no id: the caller's tenant itself |
| `.onContext([type,] source)` | the authority resolves the id from the request |
| `.hide()` | a denial answers `NOT_FOUND`; the authority's `hidden(resource, action)` config does it per resource |
| `.orCreateOn(type, field)` | an upsert: without the id field, check the parent `type` from `field` |
| `.list()` | no check before the handler; it filters what it returns with `allowed` or a list plan |

Every requirement carries `GG_AUTHZ_ERRORS` (`NOT_AUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`APPROVAL_REQUIRED`, `INSUFFICIENT_SCOPE`, `STEP_UP_REQUIRED`), which grest-ts merges into the
method's errors. List the authority in the schema's `use:` next to its credential wire; see
`GGAuthority` in [`@grest-ts/http`](../../../packages/http/http/README.md).

---

## 3. Server — the engine and the authority

### The engine

```ts
const authz = new GGAuthz({model: AppAuthz, policies, resolver, facts, approvals})
```

The constructor validates `policies` with `IsGGAuthzPolicies` (throwing `GGIssuesList`), resolves
every role and action name and indexes the policies. **One engine per tenant**: cache an instance
and rebuild it when that tenant's policies change (~20 ms for 5k bindings). The tree, groups and
attributes are read on every request, so changes to them need no rebuild.

| Config | |
|---|---|
| `model` | from `defineAuthzModel`, or a plain `GGAuthzModel` |
| `policies` | the tenant's `GGAuthzPolicies` (§4) |
| `resolver` | the scope tree, groups and attributes, below |
| `facts?` | `(name, request) => boolean \| undefined`; default: boolean values from `request.context` |
| `approvals?` | `(request, decision) => Promise<void>`: obtains approval or throws |
| `unknownActions?` | `"throw"` (default) or `"ignore"` |

**`unknownActions: "ignore"`** is for tenant data that still names actions of an uninstalled
module. Each unknown action is dropped from its role, statement, approval rule, guardrail or
boundary, and `authz.inactive` lists where it was. This is safe both ways: no request can name an
unknown action, and a ceiling left with no known actions still caps everything. Keep the stored
data, so reinstalling restores it; reject unknown actions when an admin *saves* a policy.

### The resolver

```ts
interface GGAuthzResolver {
    ancestors(rn: string): Awaitable<readonly string[]>            // nearest first, without rn
    groups(principal: string): Awaitable<readonly string[]>        // "user:ben" → ["group:eng", ...], transitively
    attributes?(entity: string): Awaitable<Record<string, unknown> | undefined>  // principal key or rn
}
```

Before deciding, the engine loads in one step what the request needs: the resource's ancestors,
the groups of every principal in it, and attributes only if a policy uses them; the decision then
runs synchronously. A batch shares the loads. Return the whole ancestor list in one call.

A request may carry its resource's ancestors and attributes in `resource.properties`
(`{ancestors, attributes}`), and then the resolver isn't asked — use it when the handler has just
read the row. `GGAuthzMemoryResolver` is an in-memory resolver for tests and small worlds.

### The subject

Your auth wire handler sets `GG_AUTHZ_SUBJECT` once per request, from the verified token:

```ts
GG_AUTHZ_SUBJECT.set({
    type: "client", id: claims.client_id,
    properties: {onBehalfOf: {type: "user", id: claims.sub}, scopes: claims.scope.split(" ")},
})
```

### The authority

`GGAuthzAuthority` decides requirements for a grest-ts `GGAuthority`, after input validation and
before the handler:

```ts
const authority = new GGAuthzAuthority({
    partition: "acme", tenantType: Org.types.org,
    tenant: () => TENANT.get().id,
    engine: tenantId => engines.forTenant(tenantId),  // your per-tenant cache: Promise<GGAuthz>
    facts: (action, resource) => ...,              // request-time facts, e.g. published
    contexts: {currentDoc: () => ...},
})
authority.register(Docs.types.doc, (tenantId, id) => docs.loadForAuthz(tenantId, id))   // → {properties: {ancestors, attributes}, row} | undefined
authority.assertLoaders([DocsApiContract, FoldersApiContract])

// api package: export const DOCS_AUTHORITY = new GGAuthority("docs"), listed in the schemas' `use:`
const DOCS_AUTHORITY_HANDLER = DOCS_AUTHORITY.define((handler: GGAuthorityHandler) => handler)
DOCS_AUTHORITY_HANDLER.create(authority)                // in compose()
```

- **Loaders** are registered per resource type by whoever owns the rows, and are tenant-scoped: a
  missing row, one from another tenant, or an id that can't form an RN is `NOT_FOUND`. A row is
  loaded once per request; the handler takes it with `authority.row(type, id)`.
- `assertLoaders(contracts)` throws for each method whose requirement needs a type with no loader;
  run it at startup.
- **Authorize before loading.** A missing resource and a forbidden one both get `FORBIDDEN` (or
  `NOT_FOUND` when hidden), so nothing leaks.

In handlers, for checks that depend on the row's state:

| | |
|---|---|
| `assert(action, {type, id})` | throws like a requirement |
| `can(action, ref)`, `allowed(action, refs)` | booleans; for a workload, an allow that needs approval is `false` |
| `authorizeGrant(role, principal, ref)` | `canGrant` for the caller (§6) |
| `missingActions(actions, ref)` | which of `actions` the caller can't hand out |
| `approvalNeed(action, ref)` | what an approval would need, for asking it |

Pass `properties` when the handler already holds the row. Optional config: `approvals(need)`
obtains an approval or throws; `hidden(resource, action)` answers `NOT_FOUND` per resource;
`explainForbidden` replaces a bare `FORBIDDEN` with one that says why; `undeclared(call, action)`
reports a handler deciding an action its method's requirements don't name; `approvalLevelAttribute`
names a resource attribute that raises the approval level. When an approval is for another
resource than the one decided (a create's new row), `registerApprovalKey(action, (input, resource)
=> ({type, id}))` names it; `APPROVAL_REQUIRED` then carries it as `key`.

What a denial throws:

| Throws | When |
|---|---|
| `NOT_AUTHORIZED` | no subject in context |
| `INSUFFICIENT_SCOPE` (403, `{scopes}`) | denied only by the token scopes, and any of `scopes` would allow it |
| `STEP_UP_REQUIRED` (401, `{facts}`) | denied, and allowed once the step-up `facts` hold |
| `FORBIDDEN` | denied otherwise; `debugMessage` is the `GGAuthz.explain` sentence |
| `NOT_FOUND` | the resource doesn't resolve, or the denial is hidden |
| `APPROVAL_REQUIRED` (403, `{action, resource, level, key?}`) | the decision needs approval and no `approvals` is configured |
| `Error` | a programming error: an action the model doesn't know, or one that doesn't apply to the RN's type |

Without an authority, `authz.authorize(action, rn, context?, properties?)` does the same for an RN,
reading the subject from `GG_AUTHZ_SUBJECT`; `context` carries request-time facts. A method whose
handler decides with `authorize` or `authority.assert` and has no requirement of its own lists
`...GG_AUTHZ_ERRORS` in its `errors`. Step-up facts are declared in the model and set from
the token's `acr`/`amr` claims; mapping them to `acr_values` is yours.

---

## 4. Policies — per tenant, as data

```ts
const policies: GGAuthzPolicies = {
    roles: [{name: "auditor", actions: ["docs:Export"], includes: ["viewer"]}],
    bindings: [
        {principal: "group:eng", role: "editor", on: "rn:acme:org:acme:project/web"},
        {principal: "everyone", role: "viewer", on: "rn:acme:docs:acme:folder/handbook", when: ["published"]},
    ],
    resourcePolicies: [{
        on: "rn:acme:docs:acme:doc/salaries",
        statements: [
            {sid: "ben-reads", effect: "allow", principals: ["user:ben"], actions: ["docs:Read"]},
            {sid: "only", effect: "deny", principals: ["everyone"], except: ["user:ben", "group:admins", "agent:*"], actions: ["docs:*"]},
        ],
        approvals: [{actions: ["docs:Read"], level: "ask"}],
    }],
    boundaries: [{
        id: "assistants", principals: ["agent:*"],
        allow: [
            {actions: ["docs:Read", "docs:Write"], resources: ["rn:acme:docs:acme:folder/*"]},
            {actions: ["docs:Read"], when: ["published"]},
        ],
    }],
    guardrails: [
        {id: "contractors-no-export", on: org, principals: ["group:contractors"], deny: [{actions: ["docs:Export"]}]},
        {id: "export-needs-mfa", on: org, except: ["agent:*"], deny: [{actions: ["docs:Export"], unless: ["mfa"]}]},
        {id: "legal-sandbox", on: legalProject, ceiling: [{actions: ["docs:Read", "docs:Write"]}]},
    ],
}
```

- **Tenant roles** (`policies.roles`) may include model roles but not reuse their names. Unknown or
  cyclic includes fail when the engine is built.
- A **boundary** caps the principals it selects (a principal, its type or its groups); access is
  allows ∩ every boundary that reaches it. When several reach one principal, **all** apply.
- **Token scopes**: when a request carries `subject.properties.scopes`, the union of those scopes (as
  defined in `model.tokenScopes`) is one more ceiling. An empty or unknown scope list allows nothing.
- A **guardrail** is a limit nobody under its scope can exceed, admins included: deny rules, a
  ceiling, or both.
- A resource policy naming a user doesn't bypass that user's boundary.

### Acting for someone else

A request may carry an acting principal plus an on-behalf-of human, a delegation chain and
restrictions:

```ts
subject: {
    type: "client", id: "notes-app",
    properties: {
        onBehalfOf: {type: "user", id: "ann"},
        via: [{type: "agent", id: "assistant-ann"}],
        restrictions: [{actions: ["docs:Read"], resources: ["=rn:acme:docs:acme:doc/onboarding"]}],
    },
}
```

- **Allows** (bindings, allow statements) come only from `onBehalfOf`. An agent's own bindings don't
  widen what it can do for someone else.
- **Ceilings** (boundaries) come from every acting principal: the subject and each one in `via`.
- **Denies** and guardrails are checked against *each* identity on its own: one applies when it
  selects that identity and doesn't exempt that same one. So an exempt agent doesn't carry a
  non-exempt human through, nor the reverse. To let agents act for exempt people, exempt both:
  `except: ["user:ben", "agent:*"]`.
- **Approvals** apply if any acting principal is a workload.
- **Restrictions** are a per-request ceiling, e.g. from a token's authorization details. They never
  grant.

### Conditions and facts

Every condition on a binding or rule must hold. **Attribute conditions** are data, so tenants can
write their own:

```ts
conditions: [
    {key: "resource.owner", op: "eq", ref: "principal.key"},        // the owner pattern
    {key: "resource.status", op: "in", value: ["draft", "review"]},
    {key: "context.ip", op: "startsWith", value: "10."},
]
```

| | |
|---|---|
| keys | `principal.*` (whose permissions: the human when acting on behalf), `actor.*` (the acting principal), `resource.*`, `context.*`. Built in: `principal.key`, `actor.key`, `resource.rn` |
| operators | `eq`, `ne`, `in`, `notIn` (an array), `lt`, `le`, `gt`, `ge` (numbers), `startsWith`, `contains` (on an array attribute), `present` (`true`/`false`) |
| unknown | a missing attribute, or one of the wrong type for the operator; fails closed like a fact |

**Facts** are named booleans your code computes: `when: [...]` (all true) and `unless: [...]` (all
false). The engine asks your `facts` provider lazily, only for statements that otherwise match, at
most once per request. A fact is `true`, `false` or unknown (`undefined`), and **unknown fails
closed in both directions**:

| Rule | Fact unknown |
|---|---|
| allow, binding or ceiling rule with `when`/`unless` | doesn't grant / doesn't pass |
| deny or guardrail deny with `when`/`unless` | **applies** |

So a `when: ["frozen"]` deny holds until the caller says `frozen: false`.

---

## 5. Approvals — a human confirms first

A third outcome besides allow and deny, `allow-with-approval`, for workloads only.

- Levels, least to most strict: `auto` < `ask-once` < `ask` < `critical` < `humans-only`.
- Resource policies set levels per action (`approvals`), inherited down the tree. **The deepest
  setting wins**, so a doc may lower an unlocked folder default.
- `locked: true` makes a level a minimum for everything below; a lowering attempt is ignored and
  reported (`lowered` in the reason). `model.approvalFloor` is always locked.
- Two matching rules in one policy: the stricter wins.
- **An approval never widens access**: it is computed only when the request would otherwise be
  allowed. `humans-only` denies workloads; `auto` still sets `audit: true`; humans get no level.

---

## 6. Evaluation order

| # | Layer | Denies when | Reason `layer` |
|---|---|---|---|
| 1 | request | the RN doesn't parse, is in another partition, or its scope chain is cyclic or too deep | `request` |
| 2 | explicit deny | a guardrail deny rule or a resource-policy deny statement on the resource or an ancestor matches | `guardrail`, `deny` |
| 3 | ceilings | a guardrail ceiling on the chain, a boundary of any acting principal, the token scopes or the request's restrictions has no matching rule | `guardrail`, `boundary`, `scope`, `restriction` |
| 4 | allows | — grants: bindings ∪ resource-policy allow statements on the chain | `allow` |
| 5 | approval | a workload request whose resolved level is `humans-only` | `approval` |
| 6 | default deny | no allow was found in step 4 | `default` |

A statement whose conditions don't hold simply doesn't apply, for denies, ceilings and allows alike.
Every layer is a conjunction, so **the outcome doesn't depend on the order**; the order only decides
which reasons are reported. A deny reports the first layer that denied, with every matching
statement in it. An allow reports every grant, every ceiling that passed, and the approval level.

---

## 7. Beyond yes/no

### `evaluate`: AuthZEN 1.0, never throws

For batch checks or a decision service. The subject is explicit. Request and response follow
[OpenID AuthZEN 1.0](https://openid.net/specs/authorization-api-1_0.html).

```ts
const decision = await authz.evaluate({
    subject: {type: "agent", id: "assistant-ben", properties: {onBehalfOf: {type: "user", id: "ben"}}},
    action: {name: "docs:Read"},
    resource: {type: "docs:doc", id: "rn:acme:docs:acme:doc/salaries"},
    context: {mfa: true},
})
// {decision: true, context: {outcome: "allow-with-approval", approval: "ask", audit: true, reasons: [
//     {layer: "allow", kind: "statement", id: "ben-reads", on: "rn:…/salaries", principal: "user:ben", actions: ["docs:Read"]},
//     {layer: "boundary", kind: "ceiling-passed", id: "assistants", actions: ["docs:Read"]},
//     {layer: "approval", kind: "approval", level: "ask", on: "rn:…/salaries", locked: false},
// ]}}
```

`allow-with-approval` is `decision: true`, so check `context.outcome` before acting. On a deny,
`context.remedy` is `{scopes}` or `{stepUp}`. Validate outside requests with `IsGGAuthzRequest`.
`evaluateBatch` takes AuthZEN evaluations; top-level `subject`, `action`, `resource` and `context`
are defaults for each, and contexts merge.

### `listAllowed`: a query plan, not a loop

Never list resources by authorizing every row. `listAllowed` reads only the policies and returns a
`GGAuthzPlan` your data layer turns into key queries:

```ts
const plan = await authz.listAllowed({
    subject: {type: "user", id: "ann"},
    action: {name: "docs:Write"},
    resource: {type: "docs:doc"},
    context: {ip: "10.0.0.7"},
})
// {
//   include: [{within: "rn:…/doc/onboarding"}, {within: "rn:…/project/web"}],     // at least one
//   exclude: [{within: "rn:…/org/acme", resources: [...], unless: ["mfa"]}],       // none
//   require: [{id: "legal-sandbox", within: "rn:…/project/legal", anyOf: [...]}],  // ceilings
// }
```

- `include` lists the scopes where the principal has a qualifying binding or allow statement; query
  each by parent key, or its subtree if rows store their ancestor path. Empty means nothing.
- The rest are **residual filters** to apply to fetched rows: `resources` matchers, `when`/`unless`
  facts, `exceptWithin`, and the ceilings under `require` (one every row passes is dropped).
  Unknown facts: `include`/`require` need them proven, `exclude` matches unless disproven.
- Attribute conditions not involving the row are decided while planning. `resource.*` ones stay on
  the filter as `conditions`, with the values they compare against in `plan.values`.
- `humans-only` exclusions for agents are in `exclude`; other approval levels aren't, so authorize
  the row you act on.
- Planning cost is proportional to the policies, not the rows. `GGAuthz.applyPlan(plan, rns,
  {resolver, facts})` is the in-memory reference implementation.

### `canGrant`: creating bindings without escalation

```ts
const decision = await authz.canGrant({subject, binding: {principal: "user:new", role: "editor", on: projectRn}})
await authz.authorizeGrant(binding)   // the same for GG_AUTHZ_SUBJECT, throwing like authorize
```

It allows only when both hold:

1. **The grant action** (`model.grantAction`) is allowed on the scope.
2. **No escalation:** the grantor holds every action of the role there itself, through its own
   bindings on the scope or above, within its boundaries, token scopes and restrictions, and not
   denied. Allow statements don't count, since they can be tied to single resources.

A deny undecided at the scope only because a `resource.*` attribute is missing (e.g. owner-only)
doesn't count: there is no resource at a grant's scope, and the deny binds the grantee anyway.
Every other unknown still denies. Pass the facts that hold at the scope in `context`.
`missingActions({subject, actions, on, context})` answers the same for a list of actions (e.g.
editing a role). A refusal names what's missing:
`{layer: "grant", kind: "escalation", role: "editor", actions: ["docs:Write"]}`.

### `explain`, `describeAuthzModel`, `documentAuthzModel`

```ts
GGAuthz.explain(request, decision)
// "user:dan may not docs:Export on rn:…/doc/salaries: guardrail contractors-no-export on rn:…/org/acme denies docs:Export."
describeAuthzModel(AppAuthz, {contracts: [DocsApiContract]})  // structured catalog
documentAuthzModel(AppAuthz, {contracts: [DocsApiContract]})  // the same as markdown
```

The catalog lists every action with its resource types, description, roles and token scopes that
include it, approval floor, the contract methods whose requirements name it, and where it was
defined. A contract method naming an action the model doesn't know throws, so a docs or CI step
catches it. Both are in the browser entry, e.g. to show what a role grants.

---

## Limits

- **Groups are returned transitively** by the resolver; the engine doesn't expand nested groups.
- **Facts stay row residuals in list plans**; `context.*` attribute conditions are decided while
  planning.
- **One engine per tenant**, rebuilt when its policies change.
- **Cedar.** `test/cedar.ts` translates any model and policies into Cedar; `npm run test:cedar`
  asserts identical allow/deny on 10k random requests plus 500 over each of 40 random worlds. Cedar
  has no approval outcome (all levels but `humans-only` are a permit) and returns policy ids rather
  than layered reasons.
- **Performance** (`npm run bench`, one core, 10k resources, 5k bindings): `evaluate` ~0.01 ms,
  `listAllowed` ~1 ms. With a remote resolver the cost is the resolver's: one ancestors call per
  resource, one groups call per principal.

---

## Reference

**Browser entry (`@grest-ts/authz`, browser condition)** — the model and contract side:
`defineAuthzService`, `defineAuthzRole`, `defineAuthzTokenScope`, `defineAuthzModel`,
`describeAuthzModel`, `documentAuthzModel`, the action builders (`.on`, `.onContext`, `.list`, `.hide`, `.orCreateOn`), `GGAuthzRn`, the errors
(`APPROVAL_REQUIRED`, `INSUFFICIENT_SCOPE`, `STEP_UP_REQUIRED`, `GG_AUTHZ_ERRORS`), and every
`IsGGAuthz*` schema with its `GGAuthz*` type. The engine is not in it.

**Node entry (`@grest-ts/authz`)** — all of the above plus `GGAuthz` (`authorize`, `authorizeGrant`,
`evaluate`, `evaluateBatch`, `listAllowed`, `canGrant`, `missingActions`, `inactive`; statics
`explain`, `applyPlan`), `GGAuthzAuthority`, `GGAuthzMemoryResolver` and
`GG_AUTHZ_SUBJECT`.
