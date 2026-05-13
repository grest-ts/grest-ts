<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/discovery-local

IPC-based service discovery for local development and testing. Used internally by the framework — you typically don't interact with this package directly.

For a full overview of how discovery works, see the [Discovery guide](@guide/discovery).

## What it does

Runs a local discovery server that acts as a central router. Service instances connect over IPC, register their routes, and discover each other through the router. The router also acts as a reverse proxy, forwarding requests to the correct backend based on path prefix matching.

## Exported classes

| Class | Purpose |
|---|---|
| `GGLocalDiscoveryClient` | Connects to an existing discovery server |
| `GGLocalDiscoveryResilientClient` | Adds leader election with automatic failover — multiple instances compete for the router port, and if the leader dies, a follower takes over |
| `GGLocalDiscoveryServer` | The router itself |

## Testkit

Available via `@grest-ts/discovery-local/testkit`:

- `GGLocalRoutingStrategySelector` — controls routing strategies in tests (e.g. `first`, `roundRobin`, or a custom strategy)
