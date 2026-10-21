# Scale profile template

Suggest adding this to the project's `CLAUDE.md` / `AGENTS.md` (or the agent context file the project uses), filled in from what the review learned. Keep it short — it is read on every review and by every agent working on the code.

```markdown
## Scale profile

- **Kind:** <internal tool | single-tenant app | multi-tenant SaaS | fleet platform (VMs/devices/agents)>
- **Expected scale (12 months):** <users>, <tenants>, largest tenant <size>; growth unit <e.g. ~3 VMs per user per day, events per day>
- **Shared across tenants:** <credentials, provider accounts, quotas, buckets, keys — or "nothing">
- **Services:**
  - <service> — <N instances | 1 by design> — <why>
  - <service> — ...
- **Accepted limits (scale debt):**
  - <choice> — ceiling <what/when> — revisit when <trigger>
```

Fill only what you know; mark guesses with `?` so the user can correct them. The "Accepted limits" list is what keeps reviews from re-raising deliberate trade-offs as defects while still keeping them visible.
