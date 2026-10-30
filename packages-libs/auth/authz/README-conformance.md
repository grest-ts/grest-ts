# Conformance

How far the core expresses four widely used authorization models, checked against their official
documentation, plus a play-test product. Every rule the engine can express is a passing test in
`test/conformance/`. The rest is classified here.

| Model | File |
|---|---|
| AWS IAM (identity, resource, SCP, RCP, permission boundaries, session policies, conditions) | `aws-iam.test.ts` |
| Google Cloud IAM (hierarchy, allow and deny policies, principal access boundaries, conditions) | `gcp-iam.test.ts` |
| Zanzibar-style relationships (paper, OpenFGA and SpiceDB modelling guides) | `rebac.test.ts` |
| GitHub organizations, teams, repositories, rulesets, tokens and apps | `github.test.ts` |
| Play-test: an IDE with an extension marketplace, profiles, managed settings, org-provided resources, plugins and an AI assistant | `ide.test.ts` |

## Result

The core holds. Explicit deny wins, ceilings intersect, allows combine, everything inherits down a
scope tree, and the actor and authority are kept apart. That carries AWS's evaluation chain,
GCP's hierarchy with its deny and boundary policies, GitHub's whole org/team/repo model, and the
tree-shaped half of Zanzibar. Every condition in the four models could be written as a
caller-computed fact.

What doesn't fit is either additive, or one of the semantic differences below. The three that
failed open (cases 1, 2 and 3) and the missing exact matcher (case 5) are fixed. Each fix is
covered by `test/semantics.test.ts` and by the Cedar differential test.

## Where the engine answers differently

| # | Case | Source | Documented | Engine | Direction |
|---|---|---|---|---|---|
| 1 | A deny `when: [fact]` whose fact is unknown | GCP deny, SpiceDB caveats | deny applies (GCP) or conditional result (SpiceDB) | **fixed**: applies | — |
| 2 | An allow `unless: [fact]` whose fact is unknown | GCP conditions | never grants | **fixed**: doesn't grant | — |
| 3 | A deny `except` that names only the acting app, while the user it acts for isn't exempt | GitHub (undocumented) | unclear | **fixed**: each identity must clear the deny on its own | — |
| 4 | Cross-tenant request granted on only one side (identity or resource policy) | AWS cross-account | denied: both sides must allow | **allowed**: allows are one union | open |
| 5 | A plain RN matcher against a child, e.g. a bucket ARN against an object in it | AWS resources | no match | match by default; **fixed** with `=rn:…`, which matches that resource only | — |
| 6 | Several boundaries reached through different groups | GCP principal access boundaries | union | intersection | closed |
| 7 | Same-tenant resource policy naming the user or session directly, outside its boundary or session policy | AWS | allowed | denied | closed |
| 8 | Exclusion inside one branch of a union (`(editor - blocked) ∪ owner`); deny on a parent vs a direct grant on the child | Zanzibar, OpenFGA | allowed | denied: a deny overrides every grant path | closed |
| 9 | A role on a parent also grants its actions on same-type children without an explicit "from parent" | OpenFGA | not granted | granted: inheritance is per scope, not per relation | open |

## Recommendations

**Fixed in the core**, besides cases 1, 2, 3 and 5: **no-escalation at a scope (`canGrant`,
`missingActions`).** A deny undecided only for want of a `resource.*` attribute doesn't count against
holding an action (it binds the grantee too); a principal, actor or context unknown, or a missing
fact, still does (fail closed).

**Open semantic questions:**

1. **Cross-tenant (case 4).** Either give principals a home tenant and require both sides when it
   differs from the resource's, or declare cross-tenant principals out of scope. The second option
   means one engine per tenant, with other tenants' principals given only public grants. Today: out
   of scope.
2. **Boundary combination (case 6).** Keep intersection, as AWS does; it's the safe default.
   Optionally offer a union mode for boundaries that share an id prefix.
3. **Direct grants and Zanzibar exclusion (cases 7 and 8).** Keep ours. Both are the stricter
   direction, and AWS's bypass is a known surprise.

**Additions, in order of how many models asked for them.**

| Addition | Asked by | Status / sketch |
|---|---|---|
| Tenant-defined roles with inheritance | AWS managed policies, GCP custom roles, GitHub custom roles | **done**: `policies.roles`, `includes` |
| Conditions as data (operators over principal, resource and request attributes) | AWS, GCP, SpiceDB caveats | **done**: `conditions: [{key, op, value \| ref}]`, attributes from the resolver, row conditions residual in plans |
| Wider matchers | AWS, GCP, GitHub | action globs (`s3:Get*`), resource globs, `notActions`/`notResources`, `exceptActions` (the exact matcher is done) |
| Per-request ceilings | AWS session policies, GitHub fine-grained tokens | **done**: `subject.properties.restrictions` |
| Exemption by permission | GitHub (admins bypass branch protection by default, role entries on bypass lists) | `unlessAllowed: "repo:Bypass"` on a deny, evaluated without recursion into denies |
| Non-inheriting bindings (case 9) | OpenFGA, SpiceDB | `exact: true` on a binding or statement |
| Reverse lookup (who can access X) | Zanzibar Expand, SpiceDB LookupSubjects | a principal-by-resource index over bindings and statements |
| Groups from the request | OpenFGA contextual tuples (token claims) | `subject.properties.groups` merged into the identity |
| Binding expiry, per-action boundaries, role scoping and disabling | SpiceDB, GCP | small fields on bindings, boundaries and roles |

**Out of scope, deliberately:**

- **Multiple parents and relation algebra** (a document in two folders; `reader & writer`;
  arrows over arbitrary relations). This is a graph model, not a tree. It would change the scope
  chain, list plans and the Cedar mapping. Use a Zanzibar-style system if you need it.
- **Storage and consistency** (Zanzibar zookies, watch, indexing). The engine is pure.
- **Product-specific rules** (AWS root user, VPC endpoint policies, GCP Organization Policy
  constraints, GitHub outside-collaborator membership rules).

## Play-test: an IDE

Not a published model, but a product shape: an IDE whose org provides profiles, extensions and
resources such as deploy sites, and whose plugins use them for the user. Every scenario passes
without changes to the core.

Where it strained:

1. **Ceilings cover every action under their scope.** An allowlist at the org would also block
   opening workspaces. It works by giving the catalog its own scope node; an action-scoped
   ceiling would remove the need. This belongs with the wider matchers addition.
2. **Two-resource actions.** "Activate extension X in workspace W" became a child resource
   `workspace/W/extension/X`. Selecting "X in every workspace" needs an attribute condition,
   because matchers can't wildcard a middle segment.
3. **Items without entity rows.** A setting name travels in `context.setting`, not as a resource.
   That is enough for locks, and a missing name fails closed.
4. **Caps are opt-in.** A plugin with no boundary of its own is limited only by boundaries that
   select its type. Always give workload types a type-wide boundary; a model option that denies
   workloads without one would make this the default.
5. **Not authorization:** merging setting values across default, org, team, user and workspace
   layers. The engine decides who may write at which layer, not the resulting value.

## Resolver contract

All four models need group membership returned **transitively** (GCP nested groups, GitHub child
teams, Zanzibar group-in-group). The engine doesn't expand nesting itself, so a resolver that
returns only direct groups silently loses inherited access.
