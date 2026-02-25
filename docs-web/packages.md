---
title: "Packages"
description: "Overview of all grest-ts packages and how they relate"
---

# Packages

grest-ts is organized into four categories. The diagram below shows the major packages and how they depend on each other — arrows point from a dependency to the packages that use it.

```mermaid
flowchart TD
    subgraph Internals
        common[common]
        ipc[ipc]
    end

    subgraph Core
        schema[schema]
        context[context]
        locator[locator]
        http[http + websocket]
        runtime[runtime]
        testkit[testkit]
    end

    subgraph Production
        config[config]
        discovery[discovery]
        logger[logger]
        trace[trace]
        metrics[metrics]
    end

    subgraph Integrations
        db[db-mysql / db-postgre]
        sql[sql]
        struct[struct]
    end

    common --> locator
    common --> context
    schema --> context
    schema --> trace
    schema --> config
    schema --> sql
    schema --> db

    locator --> logger
    locator --> discovery
    locator --> metrics
    locator --> config
    locator --> runtime

    context --> http
    context --> runtime
    context --> ipc

    discovery --> http
    discovery --> runtime
    logger --> http
    logger --> runtime
    logger --> ipc
    trace --> http
    metrics --> http

    runtime --> testkit
    config --> db
    logger --> db
```

### Reading the diagram

- **Internals** sit at the foundation — `common` provides shared utilities and `ipc` handles inter-process communication.
- **Core** packages build the framework skeleton: `schema` defines contracts, `context` and `locator` provide request-scoped state and service wiring, `http`/`websocket` serve traffic, `runtime` bootstraps everything, and `testkit` drives integration tests.
- **Production** packages plug in through `locator` and `context` — configuration, service discovery, logging, tracing, and metrics are all swappable.
- **Integrations** consume core + production to connect to external systems (databases, binary protocols).

---

<!-- GENERATED-PACKAGE-TABLES -->
