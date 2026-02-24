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
