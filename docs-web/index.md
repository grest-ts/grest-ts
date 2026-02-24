---
layout: home

hero:
  name: grest-ts
  text: Contract-First Testable TypeScript Services
  tagline: Define your API once. Get typed server handlers, typed clients, and typed test utilities automatically.
  image:
    src: /logo.png
    alt: grest-ts
  actions:
    - theme: brand
      text: Get Started
      link: /guide/
    - theme: alt
      text: View on GitHub
      link: https://github.com/grest-ts/grest-ts

features:
  - title: Contract-First
    details: Single source of truth — define your API contract once, get typed server, client, and tests automatically.
  - title: Testing That Survives Refactors
    details: Integration tests at the contract level with per-request mocks and spies. Each test gets its own isolated runtime.
  - title: Performance
    details: Schema validation as fast as Typia. HTTP server benchmarks near Fastify. Zero runtime overhead from framework abstractions.
  - title: No Magic
    details: No DI containers, no decorators-as-wiring. Your Runtime's compose() is your bootstrap — all wiring visible in one place.
  - title: Service Discovery
    details: Zero-config local dev. Services find each other automatically. Pluggable for production (Kubernetes, Consul, etc.)
  - title: Typed Errors
    details: Errors carry reference IDs, typed data, and flow across service boundaries as discriminated unions.
  - title: AI-Era Ready
    details: Clean, explicit service code with no magic to misunderstand and no hidden wiring to hallucinate about.
  - title: Scalable
    details: From a single runtime to hundreds of microservices. Same patterns, same contracts, same tests. Monorepo or multi-repo.
  - title: Tree-Shakable
    details: Fully tree-shakable for minimal bundle sizes. For server packages, 400 MB vs 5 MB starts to matter at scale.
---

<style>
.code-demo { max-width: 960px; margin: 0 auto; padding: 0 24px 64px; }
.code-demo h2 { text-align: center; font-size: 28px; margin-bottom: 8px; }
.code-demo .subtitle { text-align: center; color: var(--vp-c-text-2); margin-bottom: 32px; }
.code-demo h3 { margin-top: 32px; }
</style>

<div class="code-demo">

## See It In Action

<p class="subtitle">Define once, implement, test — three files and you have a fully typed API.</p>

### 1. Define the Contract

```typescript
// api/src/api/ItemApi.ts
const IsItem = IsObject({
    id: IsNumber,
    title: IsString
})

const ItemApiContract = new GGContractClass("ItemApi", {
    list: {
        success: IsArray(IsItem),
        errors: [SERVER_ERROR]
    },
    create: {
        input: IsObject({
            title: IsString
        }),
        success: IsItem,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    }
})

export const ItemApi = httpSchema(ItemApiContract)
    .pathPrefix("api/items")
    .routes({
        list: GGRpc.GET("list"),
        create: GGRpc.POST("create")
    })

```

### 2. Implement and Run

```typescript
// server/src/AppRuntime.ts
export class AppRuntime extends GGRuntime {
    public static readonly NAME = "app"

    protected compose(): void {
        new GGHttp()
            .http(ItemApi, new ItemApiImpl())
    }
}
```

```bash
tsx src/AppRuntime.ts    # That's it. Service is running.
```

### 3. Test It

```typescript
// server/test/integration/item.test.ts
describe("Item API", () => {
    GGTest.startWorker(AppRuntime)

    const ctx = new TestContext("Items").apis({item: ItemApi})

    test("create and list items", async () => {
        await ctx.item.create({title: "Buy groceries"})
            .toMatchObject({id: 1, title: "Buy groceries"})

        await ctx.item.list()
            .toHaveLength(1)
    })
})
```

```bash
vitest    # Each test suite gets its own runtime with isolated ports.
```

</div>
