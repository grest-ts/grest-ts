---
layout: home

hero:
  name: grest-ts
  text: Contract-First Testable TypeScript Services
  tagline: One contract. Typed server, typed tests, typed client. Zero magic.
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
  - title: AI-Era Ready
    details: Clean, explicit service code with no magic to misunderstand and no hidden wiring to hallucinate about.
  - title: Testing That Survives Refactors
    details: Integration tests at the contract level with per-request mocks and spies. Each test gets its own isolated runtime.
  - title: No Magic
    details: No DI containers, no decorators-as-wiring. Your Runtime's compose() is your bootstrap — all wiring visible in one place.
  - title: Performance
    details: Schema validation as fast as Typia. HTTP server benchmarks near Fastify. Zero runtime overhead from framework abstractions.
  - title: Service Discovery
    details: Zero-config local dev. Services find each other automatically. Pluggable for production (Kubernetes, Consul, etc.)
  - title: Typed Errors
    details: Errors carry reference IDs, typed data, and flow across service boundaries as discriminated unions.
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

<div class="code-demo">

## See It In Action

<p class="subtitle">Define once, implement, test — three files and you have a fully typed API.</p>

<div class="step">
    <span class="step-badge">1</span>
    <div class="step-text">
        <h3>Define the Contract</h3>
        <p class="step-desc">Single source of truth — Typia-speed validation, no compiler plugin, no build step.</p>
    </div>
</div>

```ts
// api/src/api/ItemApi.ts

// Standard schema definitions.
export const IsItem = IsObject({
    id: IsNumber,
    title: IsString
})

export const IsCreateItemRequest = IsObject({
    title: IsString
})

// Define custom errors with typed data.
const OUT_OF_STOCK = GGerror.define("OUT_OF_STOCK", IsObject({
    amountLeft: IsNumber
}));

// Define your contract - think about those like a function signatures.
const ItemApiContract = new GGContractClass("ItemApi", {
    list: {
        success: IsArray(IsItem),
        errors: [SERVER_ERROR, OUT_OF_STOCK] // We say what errors our contract can return.
    },
    create: {
        input: IsCreateItemRequest,
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

<div class="step">
    <span class="step-badge">2</span>
    <div class="step-text">
        <h3>Wire Up and Run</h3>
        <p class="step-desc">One line to bind your contract. Your Runtime is the bootstrap — all wiring visible in one place.</p>
    </div>
</div>

```typescript
// server/src/AppRuntime.ts
export class AppRuntime extends GGRuntime {
    public static readonly NAME = "app"

    protected compose(): void {
        new GGHttp().http(ItemApi, new ItemApiImpl())
    }
}

// Simple implementation examples
type ItemApiContract = GGContractImplementation<typeof ItemApiContract.methods>;
export class ItemApiImpl implements ItemApiContract {

    private readonly geocoder = new GeocodingService();

    public list = async (): Promise<Item[]> => {
        // ...
    }
    public create = async (input: typeof IsCreateItemRequest.infer): Promise<Item> => {
        // ... Also use geocoder here ...
        throw OUT_OF_STOCK({amountLeft: 10}) // throw errors.
    }
}

@mockable // This enables mocking/syping in tests for internal classes.
export class GeocodingService {
    async resolve(address: string): Promise<LatLng> {
        return await this.client.geocode(address)
    }
}
```

```bash
tsx src/AppRuntime.ts    # That's it. Service is running. 
# Launch more to get load balanced multi-instance local setup... 
```

<div class="step">
    <span class="step-badge">3</span>
    <div class="step-text">
        <h3>Test Everything</h3>
        <p class="step-desc">Real workers, real ports, per-request mocks. Each test gets its own isolated runtime.</p>
    </div>
</div>

```typescript
// server/test/item.test.ts
describe("Item API", () => {
    GGTest.startWorker([AppRuntime, AppRuntime]) // Start as many as you want, also different services etc. 
    // Yes, it is real worker! Can also launch startInline for fastest test run speed.
    // Yes, you can get full coverage including integration tests.
    // You can mock outbound service calls. If outbound service exists, calls go through.
    // No DI - your Runtime is the bootstrap! No more duplicating whole wiring in tests.

    const myApis = new TestContext("Items")
        .apis({
            item: ItemApi
            // Add API-s you are going to call in the tests. 
            // Can be many, different services/runtimes etc. Doesn't matter.
        })

    test("create and list items", async () => {

        // Call your API-s as you normally would in clients.
        await myApis.item.create({title: "Buy groceries"})
            .toMatchObject({id: 1, title: "Buy groceries"})

        // Anything vitest supports, you can still do - even snapshots.
        const result = await myApis.item.list()
        expect(result).toMatchSnapshot()

        // Can even mock random internal classes running within your service.
        await myApis.item.create({title: "Visit Times Square"})
            .with(
                mockOf(GeocodingService).resolve // Mock applies only during this request, nicely scoped!
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

<div class="step">
    <span class="step-badge">4</span>
    <div class="step-text">
        <h3>Get started</h3>
        <p class="step-desc">Copy the starter service to get going quickly.</p>
    </div>
</div>

```bash
# Start with a simple starter template
npm create @grest-ts/starter my-app

# Terminal 1 — server
cd server && npm run dev

# Terminal 2 — client
cd client && npm run dev
```

<div class="step">
    <span class="step-badge">5</span>
    <div class="step-text">
        <h3>Get building</h3>
        <p class="step-desc">Everything is wired up — API contract, server handler, integration test, and a client that calls the API. Build on it. <br /> 
            Even your AI buddy is going to enjoy it!</p>
    </div>
</div>




<div class="cta-buttons">
    <a href="/guide/" class="cta-button primary">Get Started</a>
    <a href="https://github.com/grest-ts/grest-ts" class="cta-button secondary">View on GitHub</a>
</div>





</div>
