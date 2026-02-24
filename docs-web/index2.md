---
layout: home

hero:
  name: grest-ts
  text: Contract-First Testable TypeScript Services
  tagline: One contract. Typed server, typed client, typed tests. Zero magic.
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
  - icon: 📝
    title: Contract-First
    details: Define your API once — typed server, client, and tests generated automatically.
  - icon: 🧪
    title: Tests That Survive Refactors
    details: Contract-level integration tests with per-request mocks. Each test gets its own isolated runtime.
  - icon: ⚡
    title: Performance
    details: Schema validation as fast as Typia. HTTP benchmarks near Fastify. Zero runtime overhead.
  - icon: 🔍
    title: No Magic
    details: No DI containers, no decorator wiring. compose() is your bootstrap — all wiring in one place.
  - icon: 🌐
    title: Service Discovery
    details: Services find each other automatically in dev. Pluggable for production (Kubernetes, Consul, etc.)
  - icon: 🎯
    title: Typed Errors
    details: Errors carry reference IDs and typed data. Flow across service boundaries as discriminated unions.
---

<style>
.code-showcase {
    max-width: 960px;
    margin: 0 auto;
    padding: 48px 24px 24px;
}

.showcase-title {
    text-align: center;
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin-bottom: 8px;
    background: linear-gradient(135deg, var(--vp-c-brand-1), #06B6D4);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.showcase-subtitle {
    text-align: center;
    color: var(--vp-c-text-2);
    font-size: 17px;
    margin-bottom: 48px;
    line-height: 1.6;
}

.step {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-top: 48px;
    margin-bottom: 16px;
}

.step-badge {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(135deg, #3B82F6, #06B6D4);
    color: white;
    font-weight: 700;
    font-size: 15px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-top: 2px;
}

.step-text h3 {
    margin: 0 0 4px 0 !important;
    padding: 0 !important;
    font-size: 20px;
    border: none !important;
    letter-spacing: -0.01em;
}

.step-desc {
    color: var(--vp-c-text-2);
    font-size: 15px;
    margin: 0;
    line-height: 1.5;
}

.cta-section {
    text-align: center;
    padding: 64px 24px 32px;
    max-width: 960px;
    margin: 0 auto;
}

.cta-section h2 {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 12px;
    letter-spacing: -0.02em;
}

.cta-section p {
    color: var(--vp-c-text-2);
    font-size: 16px;
    margin-bottom: 28px;
}

.cta-buttons {
    display: flex;
    justify-content: center;
    gap: 12px;
    flex-wrap: wrap;
}

.cta-button {
    display: inline-block;
    padding: 10px 24px;
    border-radius: 20px;
    font-weight: 600;
    font-size: 14px;
    text-decoration: none;
    transition: all 0.2s;
}

.cta-button.primary {
    background: linear-gradient(135deg, #3B82F6, #06B6D4);
    color: white;
}

.cta-button.primary:hover {
    opacity: 0.9;
    transform: translateY(-1px);
}

.cta-button.secondary {
    border: 1px solid var(--vp-c-divider);
    color: var(--vp-c-text-1);
    background: var(--vp-c-bg-soft);
}

.cta-button.secondary:hover {
    border-color: var(--vp-c-brand-1);
    color: var(--vp-c-brand-1);
}

@media (max-width: 640px) {
    .code-showcase { padding: 32px 16px 16px; }
    .showcase-title { font-size: 26px; }
    .step { gap: 12px; margin-top: 36px; }
    .step-badge { width: 28px; height: 28px; font-size: 13px; }
}
</style>

<div class="code-showcase">

<h2 class="showcase-title">See It In Action</h2>
<p class="showcase-subtitle">Three files. Fully typed API. Contract to tests in minutes.</p>

<div class="step">
    <span class="step-badge">1</span>
    <div class="step-text">
        <h3>Define the Contract</h3>
        <p class="step-desc">Single source of truth — Typia-speed validation, no compiler plugin, no build step.</p>
    </div>
</div>

```ts{7,21,23-28}
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

export type ItemApiContract = GGContractImplementation<typeof ItemApiContract.methods>;

export const ItemApi = httpSchema(ItemApiContract)
    .pathPrefix("api/items")
    .routes({
        list: GGRpc.GET("list"),
        create: GGRpc.POST("create")
    })
```

<div class="step">
    <span class="step-badge">2</span>
    <div class="step-text">
        <h3>Wire Up and Run</h3>
        <p class="step-desc">One line to bind your contract. Your Runtime is the bootstrap — all wiring visible in one place.</p>
    </div>
</div>

```ts{5,9}
// server/src/AppRuntime.ts
export class AppRuntime extends GGRuntime {
    public static readonly NAME = "app"

    protected compose(): void {
        new GGHttp().http(ItemApi, new ItemApiImpl())
    }
}

export class ItemApiImpl implements ItemApiContract {

    private readonly geocoder = new GeocodingService()

    public list = async (): Promise<Item[]> => {
        // ...
    }
    public create = async (input: CreateItemRequest): Promise<Item> => {
        // ...
    }
}

@mockable
export class GeocodingService {
    async resolve(address: string): Promise<LatLng> {
        return await this.client.geocode(address)
    }
}
```

```bash
tsx src/AppRuntime.ts    # That's it. Service is running.
```

<div class="step">
    <span class="step-badge">3</span>
    <div class="step-text">
        <h3>Test Everything</h3>
        <p class="step-desc">Real workers, real ports, per-request mocks. Each test gets its own isolated runtime.</p>
    </div>
</div>

```ts{3,5-6,10-12,14-20}
// server/test/item.test.ts
describe("Item API", () => {
    GGTest.startWorker([AppRuntime, AppRuntime]) // Launches real workers

    const myApis = new TestContext("Items")
        .apis({ item: ItemApi })

    test("create and list items", async () => {

        await myApis.item.create({title: "Buy groceries"})
            .toMatchObject({id: 1, title: "Buy groceries"})

        // Mock scoped to a single request — no test pollution
        await myApis.item.create({title: "Visit Times Square"})
            .with(
                mockOf(GeocodingService).resolve
                    .toEqual({address: "Times Square, NYC"})
                    .andReturn({lat: 40.758, lng: -73.985})
            )
            .toMatchObject({title: "Visit Times Square", lat: 40.758})
    })
})
```

```bash
vitest    # Each test suite gets its own runtime with isolated ports.
```

</div>

<div class="cta-section">

## Ready to Build?

Define your first contract in minutes. No boilerplate, no ceremony.

<div class="cta-buttons">
    <a href="/guide/" class="cta-button primary">Get Started</a>
    <a href="https://github.com/grest-ts/grest-ts" class="cta-button secondary">View on GitHub</a>
</div>

</div>
