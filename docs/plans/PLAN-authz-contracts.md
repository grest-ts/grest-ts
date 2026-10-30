# Plan: Authorization on contracts, next steps

Status: **open for discussion**. Nothing in this doc is decided unless it is under "Settled". It hands
over a long design conversation so another agent can continue it with the owner.

Read first:
- [`PLAN-permissions.md`](./PLAN-permissions.md): the original contract `permission:` field, strict mode, the gate.
- `@grest-ts/authz` README (`packages-libs/auth/authz/README.md`): the engine, its vocabulary, evaluation order.
- Kratt's as-built record: `kratt/docs/plans/AUTHZ_CONTRACTS.md` (decisions 1–12 and "where the handler still
  decides"), `kratt/docs/AUTHZ_MODEL.md`, `kratt/docs/PERMISSION_MODEL.md`.

## The goal, in the owner's words

> Access is a level above the request handler. When the handler runs, access is already checked, and that check
> is a definition on the contract. It should be easy to see who can call a request. An action should be fully
> defined by what it needs to run.

It must stay a **general grest-ts layer**: it must fit kratt, and also a real-estate app with complex SQL and
financial reports (where a report's content must not change with who asks). It must not depend on the storage
(DynamoDB, plain SQL, the grest-ts SQL builder). It should not grow into an ORM-like layer that rewrites queries.

## What exists today

| Piece | Where | What it does |
|---|---|---|
| `permission:` on contract methods, strict mode | `@grest-ts/schema` `contract/permission/`, `@grest-ts/http` | Every route must declare once any does; checked at server start |
| `GGRequirement`, `byField` | `GGRequirement.ts` | A requirement as plain data: action + where the resource id comes from. `byField(union, field, cases)` picks a requirement per union case |
| `GGAuthority` | `@grest-ts/http` `schema/GGAuthority*.ts` | Runs requirements after input validation, before the handler |
| Engine + builders | `@grest-ts/authz` | `Action.on(field)`, `.onContext(source)`, `.list()`, `.hide()`, `.orCreateOn(type)`; `GGAuthzAuthority`; `allowed` (batch), `listAllowed` (query plan), `canGrant`/`missingActions`, `explain`, `describeAuthzModel`/`documentAuthzModel` |
| Kratt's authority | `kratt/src/hub/hub-api-server-vm-manager/src/access/krattAuthority.ts` | Per-type row loaders, facts (`repoVisible`), and the "undeclared action" guard (throws outside production when a handler asserts an action its method didn't declare) |

Facts worth knowing:
- `listAllowed` has **no production caller** in kratt; list handlers batch-check rows with `allowed`.
- Kratt's scoped items use `byField` over `scope.type` (`kratt/src/platform/scoped-items/src/define/scope.ts`). That
  file keeps four parallel per-scope tables by hand. The owner suspects this should be automatic.

## Settled

1. **The requirement is data on the contract**, built from model action constants, browser-safe.
2. **One action per method.** When the input or the row's state picks the action, split the method.
3. **Centralize the decision, not data filtering.** Lists and reports use purpose-built queries that take an
   explicit scope parameter, and that scope is checked on the contract. Generated `WHERE` clauses, adapters per
   storage and per-row `.each` requirements were explored and **rejected**: they behave like an ORM, make query
   plans hard to reason about, and break on storages like DynamoDB.
4. **A list always runs inside a scope the caller can read**: `X.Read.on("projectId")`, and the handler queries
   that scope. "My things" get their own `my*` methods.
5. **A report is one action on its scope** (`Books.Read.on("associationId")`). Its content doesn't vary by caller;
   the action's description says what it reveals.
6. **Handlers may still check**, through the authority, and only actions their method declares (kratt's
   undeclared guard enforces this). That is the visible escape hatch.
7. **Keep our own engine; don't swap to Cedar.** Cedar's list filtering is experimental and most features
   (approvals, explanations, plans, no-escalation) would stay in TS. The Cedar differential test stays
   (`npm run test:cedar`), so a later swap remains mechanical.
8. **Vocabulary** is fixed by the authz README's Vocabulary section. Most apps need only principal, resource,
   action, role and binding.

## Open questions

Each has the options seen so far. Pick, refine or reject.

**A. Scope requirements without hand-written tables.** A method that takes "a scope" (`{type: "project", projectId}`
or `{type: "org"}`) needs "the caller can reach this scope" plus the item action.
- (a) Keep `byField` and hand tables, as now.
- (b) `X.in("scope")`: one polymorphic requirement. The authority reads `scope.type`, resolves it to a resource and
  checks a per-type "reach" action declared once in the model. Replaces `byField` for scopes; `byField` stays for
  methods where each case really needs a different action.
- (c) The model declares type parents (`types: {project: {parent: org}}`), and the contract only says
  `.in("scope")`; the reach action comes from the type.

**B. What `.list()` means.** Today: "no check before the handler; the handler filters". With settled point 4, is a
bare `.list()` still needed, or should every list be `.on(scope)` plus `allowed` on rows when rows can be hidden
inside the scope? Should `listAllowed` be deleted (unused) or kept for apps whose lists span scopes?

**C. Startup checks the framework could own.** Today: the field named by `.on` exists and is required, and the
action applies to the field's type. Candidates: every type a requirement loads has a loader (kratt checks this
itself); every case of a `.in` union is a type the authority can resolve.

**D. Handing the decision to the handler.** The authority already loads the row to decide. Passing it (or the
decision) to the handler through context avoids a second read. Kratt lists it as out of scope for now.

**E. Documentation from the definitions.** A generated "who can call what" table, from contracts + model (+ the
roles that grant each action). `documentAuthzModel` covers the model half.

**F. WebSockets.** `clientToServer` messages can carry requirements. Kratt's decision 11 leaves open whether a
grest-ts "topics" feature (ticket endpoint + subscribe + snapshot + version filter) belongs in the framework or
should be built in kratt first.

**G. Service-to-service.** `@grest-ts/service-auth` today only moves the shared-secret header check. The owner
wants service calls authorized without hand-written tokens. Options discussed: a runtime identity with signed
service tokens, a `callableBy: [ServiceX]` declaration on contracts, platform workload identity (AWS IAM). Should
`callableBy` be a requirement kind next to the user ones?

**H. Engine features the kratt access redesign would need.** These sit in `@grest-ts/authz`, but come from kratt's
access model work (separate discussion):
- grants with an expiry and an id (today bindings have neither; engines are rebuilt about every 30 s, so expiry
  lags that much);
- "who could grant X here", for access requests;
- a restriction that holders of one action pass, audited (break-glass), and actions that `*` doesn't include;
- restrictions as tenant data, not only code.

## Kratt context the next agent should know

Kratt's own open access-model work depends on the answers above but is a separate thread: one grant table with
`until` and people asking for access like agents do; agent profiles (a cap per project or workspace); a project's
owning team for settings; and a privacy gap where org admins can read other members' chat transcripts
(`chats:ReadTranscript` is not owner-only). Projects are image recipes whose visibility comes from GitHub repo
access; teams are a "who", sourced from the IdP.

## Suggested first step for the discussion

Settle **A** and **B** together. They decide whether kratt's `scope.ts` tables and `byField` usage go away, and
they are the parts the owner felt were wrong. Use one kratt method (e.g. a scoped-items `list`) and one real-estate
method (a building's apartments, the association's balance sheet) as the test cases.
