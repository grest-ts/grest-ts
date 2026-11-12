# Fakes for third-party services: decided, not a framework feature

Status: **decided (2026-11-12)**. Raised from kratt's test-quality work (fakegit, the fake OAuth server, FakeProvider).

The question was whether grest-ts should offer a base for stateful stand-ins of third parties ("fakes"). It
shouldn't. This is a coding-approach problem, and an existing pattern handles it well by shrinking the untestable
part to one small unit:

```ts
@mockable
class GitHubApi {                                   // the only class that knows GitHub's HTTP
    async mintRepoToken(repo: RepoRef): Promise<RepoToken> {
        const res = await this.http.post(`/app/installations/${id}/access_tokens`, {repositories: [repo.name]})
        return IsRepoToken.parse(res)               // structure guaranteed at the edge
    }
}

// everything above it: mocked, with small domain-shaped answers
.with(mockOf(GitHubApi).mintRepoToken.andReturn({token: "t", expiresAt: 0}))
```

- **The adapter** is thin: HTTP plus a schema parse. Unit tests on it only restate the implementation, and
  only a real call proves it. When it changes, check it live (dev or dogfooding).
- **Error decisions** (retry, re-auth, "SSO required") live above the adapter and are tested there by
  mocking a typed error. This needs grest-ts #170: in worker mode, `andReturn(new X())` must throw, and a
  thrown typed error must keep its type.
- **A fake** is only worth building for traffic that doesn't start in our code (webhooks, OAuth redirects,
  non-Node clients like `git`) or as a local dev environment. Building one is ordinary grest-ts: a `GGRuntime`,
  a custom `GGHttpCodec` for the vendor's wire, and an admin contract.

**Follow-up:** #170.
