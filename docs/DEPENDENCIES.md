<!-- THIS FILE IS GENERATED - DO NOT EDIT -->

# Package Dependencies

> 🟢 Node.js &nbsp; 🌐 Browser

```mermaid
flowchart TB
    subgraph L0[" "]
        code-generator["code-generator 🟢"]
        config-aws["config-aws 🟢"]
        create-starter["create-starter "]
        db-mysql["db-mysql 🟢"]
        db-postgre["db-postgre 🟢"]
        discovery-kubernetes["discovery-kubernetes 🟢"]
        discovery-migration["discovery-migration 🟢"]
        discovery-static["discovery-static 🟢"]
        events-aws["events-aws 🟢"]
        events-azure["events-azure 🟢"]
        events-gcp["events-gcp 🟢"]
        file-http["file-http 🟢🌐"]
        intl["intl 🟢🌐"]
        poller["poller 🟢"]
        schema-benchmark["schema-benchmark 🟢"]
        sql["sql 🟢"]
        struct["struct 🟢"]
        testkit-vitest["testkit-vitest 🟢"]
        trace-http["trace-http 🟢"]
        websocket["websocket 🟢🌐"]
        x-packager["x-packager 🟢"]
    end
    subgraph L1[" "]
        events["events 🟢"]
        http["http 🟢🌐"]
        lock["lock 🟢"]
        testkit["testkit 🟢"]
    end
    subgraph L2[" "]
        config["config 🟢"]
        logger-console["logger-console 🟢"]
        runtime["runtime 🟢"]
        testkit-runtime["testkit-runtime 🟢"]
    end
    subgraph L3[" "]
        discovery-local["discovery-local 🟢"]
        file["file 🟢🌐"]
        metrics["metrics 🟢"]
    end
    subgraph L4[" "]
        discovery["discovery 🟢"]
        ipc["ipc 🟢"]
    end
    subgraph L5[" "]
        logger["logger 🟢🌐"]
        trace["trace 🟢🌐"]
    end
    subgraph L6[" "]
        context["context 🟢🌐"]
        locator["locator 🟢"]
    end
    subgraph L7[" "]
        common["common 🟢🌐"]
        schema["schema 🟢🌐"]
    end
    code-generator --> common
    code-generator --> http
    config --> common
    config --> locator
    config --> schema
    config-aws --> config
    context --> common
    context --> schema
    db-mysql --> config
    db-mysql --> locator
    db-mysql --> logger
    db-mysql --> schema
    db-postgre --> config
    db-postgre --> locator
    db-postgre --> logger
    db-postgre --> schema
    discovery --> locator
    discovery-kubernetes --> discovery
    discovery-kubernetes --> logger
    discovery-local --> discovery
    discovery-local --> ipc
    discovery-local --> locator
    discovery-local --> logger
    discovery-local --> schema
    discovery-migration --> discovery
    discovery-migration --> logger
    discovery-static --> discovery
    discovery-static --> logger
    events --> common
    events --> config
    events --> context
    events --> discovery
    events --> locator
    events --> logger
    events --> metrics
    events --> schema
    events --> trace
    events-aws --> config
    events-aws --> events
    events-aws --> logger
    events-aws --> schema
    events-azure --> config
    events-azure --> events
    events-azure --> logger
    events-azure --> schema
    events-gcp --> config
    events-gcp --> events
    events-gcp --> logger
    events-gcp --> schema
    file --> schema
    file-http --> common
    file-http --> http
    file-http --> schema
    http --> common
    http --> context
    http --> discovery
    http --> locator
    http --> logger
    http --> metrics
    http --> schema
    http --> trace
    intl --> context
    intl --> locator
    intl --> schema
    ipc --> common
    ipc --> context
    ipc --> locator
    ipc --> logger
    ipc --> trace
    locator --> common
    lock --> locator
    logger --> locator
    logger-console --> file
    logger-console --> logger
    logger-console --> schema
    metrics --> common
    metrics --> locator
    poller --> config
    poller --> locator
    poller --> lock
    poller --> metrics
    poller --> schema
    runtime --> common
    runtime --> context
    runtime --> discovery
    runtime --> discovery-local
    runtime --> locator
    runtime --> logger
    runtime --> metrics
    runtime --> trace
    schema-benchmark --> schema
    sql --> schema
    testkit --> common
    testkit --> context
    testkit --> ipc
    testkit --> locator
    testkit --> logger
    testkit --> logger-console
    testkit --> runtime
    testkit --> schema
    testkit --> testkit-runtime
    testkit --> trace
    testkit-runtime --> locator
    testkit-vitest --> common
    testkit-vitest --> discovery
    testkit-vitest --> discovery-local
    testkit-vitest --> ipc
    testkit-vitest --> locator
    testkit-vitest --> logger
    testkit-vitest --> logger-console
    testkit-vitest --> testkit
    trace --> context
    trace --> schema
    trace-http --> http
    trace-http --> trace
    websocket --> common
    websocket --> context
    websocket --> discovery
    websocket --> http
    websocket --> locator
    websocket --> logger
    websocket --> metrics
    websocket --> schema
    websocket --> trace
    style code-generator fill:#4E79A7,stroke:#4E79A7,color:#fff
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    style config fill:#E15759,stroke:#E15759,color:#fff
    style config-aws fill:#76B7B2,stroke:#76B7B2,color:#fff
    style context fill:#59A14F,stroke:#59A14F,color:#fff
    style create-starter fill:#EDC948,stroke:#EDC948,color:#fff
    style db-mysql fill:#B07AA1,stroke:#B07AA1,color:#fff
    style db-postgre fill:#FF9DA7,stroke:#FF9DA7,color:#fff
    style discovery fill:#9C755F,stroke:#9C755F,color:#fff
    style discovery-kubernetes fill:#BAB0AC,stroke:#BAB0AC,color:#fff
    style discovery-local fill:#86BCB6,stroke:#86BCB6,color:#fff
    style discovery-migration fill:#8CD17D,stroke:#8CD17D,color:#fff
    style discovery-static fill:#B6992D,stroke:#B6992D,color:#fff
    style events fill:#499894,stroke:#499894,color:#fff
    style events-aws fill:#D37295,stroke:#D37295,color:#fff
    style events-azure fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style events-gcp fill:#FFBE7D,stroke:#FFBE7D,color:#fff
    style file fill:#D4A6C8,stroke:#D4A6C8,color:#fff
    style file-http fill:#4E79A7,stroke:#4E79A7,color:#fff
    style http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style intl fill:#E15759,stroke:#E15759,color:#fff
    style ipc fill:#76B7B2,stroke:#76B7B2,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style lock fill:#EDC948,stroke:#EDC948,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style logger-console fill:#FF9DA7,stroke:#FF9DA7,color:#fff
    style metrics fill:#9C755F,stroke:#9C755F,color:#fff
    style poller fill:#BAB0AC,stroke:#BAB0AC,color:#fff
    style runtime fill:#86BCB6,stroke:#86BCB6,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    style schema-benchmark fill:#B6992D,stroke:#B6992D,color:#fff
    style sql fill:#499894,stroke:#499894,color:#fff
    style struct fill:#D37295,stroke:#D37295,color:#fff
    style testkit fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style testkit-runtime fill:#FFBE7D,stroke:#FFBE7D,color:#fff
    style testkit-vitest fill:#D4A6C8,stroke:#D4A6C8,color:#fff
    style trace fill:#4E79A7,stroke:#4E79A7,color:#fff
    style trace-http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style websocket fill:#E15759,stroke:#E15759,color:#fff
    style x-packager fill:#76B7B2,stroke:#76B7B2,color:#fff
    linkStyle 0 stroke:#4E79A7,stroke-width:2px
    linkStyle 1 stroke:#4E79A7,stroke-width:2px
    linkStyle 2 stroke:#E15759,stroke-width:2px
    linkStyle 3 stroke:#E15759,stroke-width:2px
    linkStyle 4 stroke:#E15759,stroke-width:2px
    linkStyle 5 stroke:#76B7B2,stroke-width:2px
    linkStyle 6 stroke:#59A14F,stroke-width:2px
    linkStyle 7 stroke:#59A14F,stroke-width:2px
    linkStyle 8 stroke:#B07AA1,stroke-width:2px
    linkStyle 9 stroke:#B07AA1,stroke-width:2px
    linkStyle 10 stroke:#B07AA1,stroke-width:2px
    linkStyle 11 stroke:#B07AA1,stroke-width:2px
    linkStyle 12 stroke:#FF9DA7,stroke-width:2px
    linkStyle 13 stroke:#FF9DA7,stroke-width:2px
    linkStyle 14 stroke:#FF9DA7,stroke-width:2px
    linkStyle 15 stroke:#FF9DA7,stroke-width:2px
    linkStyle 16 stroke:#9C755F,stroke-width:2px
    linkStyle 17 stroke:#BAB0AC,stroke-width:2px
    linkStyle 18 stroke:#BAB0AC,stroke-width:2px
    linkStyle 19 stroke:#86BCB6,stroke-width:2px
    linkStyle 20 stroke:#86BCB6,stroke-width:2px
    linkStyle 21 stroke:#86BCB6,stroke-width:2px
    linkStyle 22 stroke:#86BCB6,stroke-width:2px
    linkStyle 23 stroke:#86BCB6,stroke-width:2px
    linkStyle 24 stroke:#8CD17D,stroke-width:2px
    linkStyle 25 stroke:#8CD17D,stroke-width:2px
    linkStyle 26 stroke:#B6992D,stroke-width:2px
    linkStyle 27 stroke:#B6992D,stroke-width:2px
    linkStyle 28 stroke:#499894,stroke-width:2px
    linkStyle 29 stroke:#499894,stroke-width:2px
    linkStyle 30 stroke:#499894,stroke-width:2px
    linkStyle 31 stroke:#499894,stroke-width:2px
    linkStyle 32 stroke:#499894,stroke-width:2px
    linkStyle 33 stroke:#499894,stroke-width:2px
    linkStyle 34 stroke:#499894,stroke-width:2px
    linkStyle 35 stroke:#499894,stroke-width:2px
    linkStyle 36 stroke:#499894,stroke-width:2px
    linkStyle 37 stroke:#D37295,stroke-width:2px
    linkStyle 38 stroke:#D37295,stroke-width:2px
    linkStyle 39 stroke:#D37295,stroke-width:2px
    linkStyle 40 stroke:#D37295,stroke-width:2px
    linkStyle 41 stroke:#A0CBE8,stroke-width:2px
    linkStyle 42 stroke:#A0CBE8,stroke-width:2px
    linkStyle 43 stroke:#A0CBE8,stroke-width:2px
    linkStyle 44 stroke:#A0CBE8,stroke-width:2px
    linkStyle 45 stroke:#FFBE7D,stroke-width:2px
    linkStyle 46 stroke:#FFBE7D,stroke-width:2px
    linkStyle 47 stroke:#FFBE7D,stroke-width:2px
    linkStyle 48 stroke:#FFBE7D,stroke-width:2px
    linkStyle 49 stroke:#D4A6C8,stroke-width:2px
    linkStyle 50 stroke:#4E79A7,stroke-width:2px
    linkStyle 51 stroke:#4E79A7,stroke-width:2px
    linkStyle 52 stroke:#4E79A7,stroke-width:2px
    linkStyle 53 stroke:#F28E2B,stroke-width:2px
    linkStyle 54 stroke:#F28E2B,stroke-width:2px
    linkStyle 55 stroke:#F28E2B,stroke-width:2px
    linkStyle 56 stroke:#F28E2B,stroke-width:2px
    linkStyle 57 stroke:#F28E2B,stroke-width:2px
    linkStyle 58 stroke:#F28E2B,stroke-width:2px
    linkStyle 59 stroke:#F28E2B,stroke-width:2px
    linkStyle 60 stroke:#F28E2B,stroke-width:2px
    linkStyle 61 stroke:#E15759,stroke-width:2px
    linkStyle 62 stroke:#E15759,stroke-width:2px
    linkStyle 63 stroke:#E15759,stroke-width:2px
    linkStyle 64 stroke:#76B7B2,stroke-width:2px
    linkStyle 65 stroke:#76B7B2,stroke-width:2px
    linkStyle 66 stroke:#76B7B2,stroke-width:2px
    linkStyle 67 stroke:#76B7B2,stroke-width:2px
    linkStyle 68 stroke:#76B7B2,stroke-width:2px
    linkStyle 69 stroke:#59A14F,stroke-width:2px
    linkStyle 70 stroke:#EDC948,stroke-width:2px
    linkStyle 71 stroke:#B07AA1,stroke-width:2px
    linkStyle 72 stroke:#FF9DA7,stroke-width:2px
    linkStyle 73 stroke:#FF9DA7,stroke-width:2px
    linkStyle 74 stroke:#FF9DA7,stroke-width:2px
    linkStyle 75 stroke:#9C755F,stroke-width:2px
    linkStyle 76 stroke:#9C755F,stroke-width:2px
    linkStyle 77 stroke:#BAB0AC,stroke-width:2px
    linkStyle 78 stroke:#BAB0AC,stroke-width:2px
    linkStyle 79 stroke:#BAB0AC,stroke-width:2px
    linkStyle 80 stroke:#BAB0AC,stroke-width:2px
    linkStyle 81 stroke:#BAB0AC,stroke-width:2px
    linkStyle 82 stroke:#86BCB6,stroke-width:2px
    linkStyle 83 stroke:#86BCB6,stroke-width:2px
    linkStyle 84 stroke:#86BCB6,stroke-width:2px
    linkStyle 85 stroke:#86BCB6,stroke-width:2px
    linkStyle 86 stroke:#86BCB6,stroke-width:2px
    linkStyle 87 stroke:#86BCB6,stroke-width:2px
    linkStyle 88 stroke:#86BCB6,stroke-width:2px
    linkStyle 89 stroke:#86BCB6,stroke-width:2px
    linkStyle 90 stroke:#B6992D,stroke-width:2px
    linkStyle 91 stroke:#499894,stroke-width:2px
    linkStyle 92 stroke:#A0CBE8,stroke-width:2px
    linkStyle 93 stroke:#A0CBE8,stroke-width:2px
    linkStyle 94 stroke:#A0CBE8,stroke-width:2px
    linkStyle 95 stroke:#A0CBE8,stroke-width:2px
    linkStyle 96 stroke:#A0CBE8,stroke-width:2px
    linkStyle 97 stroke:#A0CBE8,stroke-width:2px
    linkStyle 98 stroke:#A0CBE8,stroke-width:2px
    linkStyle 99 stroke:#A0CBE8,stroke-width:2px
    linkStyle 100 stroke:#A0CBE8,stroke-width:2px
    linkStyle 101 stroke:#A0CBE8,stroke-width:2px
    linkStyle 102 stroke:#FFBE7D,stroke-width:2px
    linkStyle 103 stroke:#D4A6C8,stroke-width:2px
    linkStyle 104 stroke:#D4A6C8,stroke-width:2px
    linkStyle 105 stroke:#D4A6C8,stroke-width:2px
    linkStyle 106 stroke:#D4A6C8,stroke-width:2px
    linkStyle 107 stroke:#D4A6C8,stroke-width:2px
    linkStyle 108 stroke:#D4A6C8,stroke-width:2px
    linkStyle 109 stroke:#D4A6C8,stroke-width:2px
    linkStyle 110 stroke:#D4A6C8,stroke-width:2px
    linkStyle 111 stroke:#4E79A7,stroke-width:2px
    linkStyle 112 stroke:#4E79A7,stroke-width:2px
    linkStyle 113 stroke:#F28E2B,stroke-width:2px
    linkStyle 114 stroke:#F28E2B,stroke-width:2px
    linkStyle 115 stroke:#E15759,stroke-width:2px
    linkStyle 116 stroke:#E15759,stroke-width:2px
    linkStyle 117 stroke:#E15759,stroke-width:2px
    linkStyle 118 stroke:#E15759,stroke-width:2px
    linkStyle 119 stroke:#E15759,stroke-width:2px
    linkStyle 120 stroke:#E15759,stroke-width:2px
    linkStyle 121 stroke:#E15759,stroke-width:2px
    linkStyle 122 stroke:#E15759,stroke-width:2px
    linkStyle 123 stroke:#E15759,stroke-width:2px
```

---

## Per-Package Views

### Code Generator

```mermaid
flowchart TB
    subgraph Package[" "]
        code-generator["code-generator 🟢"]
    end
    subgraph Dependencies[" "]
        common["common 🟢🌐"]
        http["http 🟢🌐"]
    end
    code-generator --> common
    code-generator --> http
    style code-generator fill:#4E79A7,stroke:#4E79A7,color:#fff
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    style http fill:#F28E2B,stroke:#F28E2B,color:#fff
    linkStyle 0 stroke:#4E79A7,stroke-width:2px
    linkStyle 1 stroke:#4E79A7,stroke-width:2px
```

### Common

```mermaid
flowchart TB
    subgraph Dependents[" "]
        code-generator["code-generator 🟢"]
        config["config 🟢"]
        context["context 🟢🌐"]
        events["events 🟢"]
        file-http["file-http 🟢🌐"]
        http["http 🟢🌐"]
        ipc["ipc 🟢"]
        locator["locator 🟢"]
        metrics["metrics 🟢"]
        runtime["runtime 🟢"]
        testkit["testkit 🟢"]
        testkit-vitest["testkit-vitest 🟢"]
        websocket["websocket 🟢🌐"]
    end
    subgraph Package[" "]
        common["common 🟢🌐"]
    end
    code-generator --> common
    config --> common
    context --> common
    events --> common
    file-http --> common
    http --> common
    ipc --> common
    locator --> common
    metrics --> common
    runtime --> common
    testkit --> common
    testkit-vitest --> common
    websocket --> common
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    style code-generator fill:#4E79A7,stroke:#4E79A7,color:#fff
    style config fill:#E15759,stroke:#E15759,color:#fff
    style context fill:#59A14F,stroke:#59A14F,color:#fff
    style events fill:#499894,stroke:#499894,color:#fff
    style file-http fill:#4E79A7,stroke:#4E79A7,color:#fff
    style http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style ipc fill:#76B7B2,stroke:#76B7B2,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style metrics fill:#9C755F,stroke:#9C755F,color:#fff
    style runtime fill:#86BCB6,stroke:#86BCB6,color:#fff
    style testkit fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style testkit-vitest fill:#D4A6C8,stroke:#D4A6C8,color:#fff
    style websocket fill:#E15759,stroke:#E15759,color:#fff
    linkStyle 0 stroke:#4E79A7,stroke-width:2px
    linkStyle 1 stroke:#E15759,stroke-width:2px
    linkStyle 2 stroke:#59A14F,stroke-width:2px
    linkStyle 3 stroke:#499894,stroke-width:2px
    linkStyle 4 stroke:#4E79A7,stroke-width:2px
    linkStyle 5 stroke:#F28E2B,stroke-width:2px
    linkStyle 6 stroke:#76B7B2,stroke-width:2px
    linkStyle 7 stroke:#59A14F,stroke-width:2px
    linkStyle 8 stroke:#9C755F,stroke-width:2px
    linkStyle 9 stroke:#86BCB6,stroke-width:2px
    linkStyle 10 stroke:#A0CBE8,stroke-width:2px
    linkStyle 11 stroke:#D4A6C8,stroke-width:2px
    linkStyle 12 stroke:#E15759,stroke-width:2px
```

### Config

```mermaid
flowchart TB
    subgraph Dependents[" "]
        config-aws["config-aws 🟢"]
        db-mysql["db-mysql 🟢"]
        db-postgre["db-postgre 🟢"]
        events["events 🟢"]
        events-aws["events-aws 🟢"]
        events-azure["events-azure 🟢"]
        events-gcp["events-gcp 🟢"]
        poller["poller 🟢"]
    end
    subgraph Package[" "]
        config["config 🟢"]
    end
    subgraph Dependencies[" "]
        common["common 🟢🌐"]
        locator["locator 🟢"]
        schema["schema 🟢🌐"]
    end
    config-aws --> config
    db-mysql --> config
    db-postgre --> config
    events --> config
    events-aws --> config
    events-azure --> config
    events-gcp --> config
    poller --> config
    config --> common
    config --> locator
    config --> schema
    style config fill:#E15759,stroke:#E15759,color:#fff
    style config-aws fill:#76B7B2,stroke:#76B7B2,color:#fff
    style db-mysql fill:#B07AA1,stroke:#B07AA1,color:#fff
    style db-postgre fill:#FF9DA7,stroke:#FF9DA7,color:#fff
    style events fill:#499894,stroke:#499894,color:#fff
    style events-aws fill:#D37295,stroke:#D37295,color:#fff
    style events-azure fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style events-gcp fill:#FFBE7D,stroke:#FFBE7D,color:#fff
    style poller fill:#BAB0AC,stroke:#BAB0AC,color:#fff
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#76B7B2,stroke-width:2px
    linkStyle 1 stroke:#B07AA1,stroke-width:2px
    linkStyle 2 stroke:#FF9DA7,stroke-width:2px
    linkStyle 3 stroke:#499894,stroke-width:2px
    linkStyle 4 stroke:#D37295,stroke-width:2px
    linkStyle 5 stroke:#A0CBE8,stroke-width:2px
    linkStyle 6 stroke:#FFBE7D,stroke-width:2px
    linkStyle 7 stroke:#BAB0AC,stroke-width:2px
    linkStyle 8 stroke:#E15759,stroke-width:2px
    linkStyle 9 stroke:#E15759,stroke-width:2px
    linkStyle 10 stroke:#E15759,stroke-width:2px
```

### Config Aws

```mermaid
flowchart TB
    subgraph Package[" "]
        config-aws["config-aws 🟢"]
    end
    subgraph Dependencies[" "]
        config["config 🟢"]
    end
    config-aws --> config
    style config-aws fill:#76B7B2,stroke:#76B7B2,color:#fff
    style config fill:#E15759,stroke:#E15759,color:#fff
    linkStyle 0 stroke:#76B7B2,stroke-width:2px
```

### Context

```mermaid
flowchart TB
    subgraph Dependents[" "]
        events["events 🟢"]
        http["http 🟢🌐"]
        intl["intl 🟢🌐"]
        ipc["ipc 🟢"]
        runtime["runtime 🟢"]
        testkit["testkit 🟢"]
        trace["trace 🟢🌐"]
        websocket["websocket 🟢🌐"]
    end
    subgraph Package[" "]
        context["context 🟢🌐"]
    end
    subgraph Dependencies[" "]
        common["common 🟢🌐"]
        schema["schema 🟢🌐"]
    end
    events --> context
    http --> context
    intl --> context
    ipc --> context
    runtime --> context
    testkit --> context
    trace --> context
    websocket --> context
    context --> common
    context --> schema
    style context fill:#59A14F,stroke:#59A14F,color:#fff
    style events fill:#499894,stroke:#499894,color:#fff
    style http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style intl fill:#E15759,stroke:#E15759,color:#fff
    style ipc fill:#76B7B2,stroke:#76B7B2,color:#fff
    style runtime fill:#86BCB6,stroke:#86BCB6,color:#fff
    style testkit fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style trace fill:#4E79A7,stroke:#4E79A7,color:#fff
    style websocket fill:#E15759,stroke:#E15759,color:#fff
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#499894,stroke-width:2px
    linkStyle 1 stroke:#F28E2B,stroke-width:2px
    linkStyle 2 stroke:#E15759,stroke-width:2px
    linkStyle 3 stroke:#76B7B2,stroke-width:2px
    linkStyle 4 stroke:#86BCB6,stroke-width:2px
    linkStyle 5 stroke:#A0CBE8,stroke-width:2px
    linkStyle 6 stroke:#4E79A7,stroke-width:2px
    linkStyle 7 stroke:#E15759,stroke-width:2px
    linkStyle 8 stroke:#59A14F,stroke-width:2px
    linkStyle 9 stroke:#59A14F,stroke-width:2px
```

### Create Starter

```mermaid
flowchart TB
    subgraph Package[" "]
        create-starter["create-starter "]
    end
    style create-starter fill:#EDC948,stroke:#EDC948,color:#fff
```

### Db Mysql

```mermaid
flowchart TB
    subgraph Package[" "]
        db-mysql["db-mysql 🟢"]
    end
    subgraph Dependencies[" "]
        config["config 🟢"]
        locator["locator 🟢"]
        logger["logger 🟢🌐"]
        schema["schema 🟢🌐"]
    end
    db-mysql --> config
    db-mysql --> locator
    db-mysql --> logger
    db-mysql --> schema
    style db-mysql fill:#B07AA1,stroke:#B07AA1,color:#fff
    style config fill:#E15759,stroke:#E15759,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#B07AA1,stroke-width:2px
    linkStyle 1 stroke:#B07AA1,stroke-width:2px
    linkStyle 2 stroke:#B07AA1,stroke-width:2px
    linkStyle 3 stroke:#B07AA1,stroke-width:2px
```

### Db Postgre

```mermaid
flowchart TB
    subgraph Package[" "]
        db-postgre["db-postgre 🟢"]
    end
    subgraph Dependencies[" "]
        config["config 🟢"]
        locator["locator 🟢"]
        logger["logger 🟢🌐"]
        schema["schema 🟢🌐"]
    end
    db-postgre --> config
    db-postgre --> locator
    db-postgre --> logger
    db-postgre --> schema
    style db-postgre fill:#FF9DA7,stroke:#FF9DA7,color:#fff
    style config fill:#E15759,stroke:#E15759,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#FF9DA7,stroke-width:2px
    linkStyle 1 stroke:#FF9DA7,stroke-width:2px
    linkStyle 2 stroke:#FF9DA7,stroke-width:2px
    linkStyle 3 stroke:#FF9DA7,stroke-width:2px
```

### Discovery

```mermaid
flowchart TB
    subgraph Dependents[" "]
        discovery-kubernetes["discovery-kubernetes 🟢"]
        discovery-local["discovery-local 🟢"]
        discovery-migration["discovery-migration 🟢"]
        discovery-static["discovery-static 🟢"]
        events["events 🟢"]
        http["http 🟢🌐"]
        runtime["runtime 🟢"]
        testkit-vitest["testkit-vitest 🟢"]
        websocket["websocket 🟢🌐"]
    end
    subgraph Package[" "]
        discovery["discovery 🟢"]
    end
    subgraph Dependencies[" "]
        locator["locator 🟢"]
    end
    discovery-kubernetes --> discovery
    discovery-local --> discovery
    discovery-migration --> discovery
    discovery-static --> discovery
    events --> discovery
    http --> discovery
    runtime --> discovery
    testkit-vitest --> discovery
    websocket --> discovery
    discovery --> locator
    style discovery fill:#9C755F,stroke:#9C755F,color:#fff
    style discovery-kubernetes fill:#BAB0AC,stroke:#BAB0AC,color:#fff
    style discovery-local fill:#86BCB6,stroke:#86BCB6,color:#fff
    style discovery-migration fill:#8CD17D,stroke:#8CD17D,color:#fff
    style discovery-static fill:#B6992D,stroke:#B6992D,color:#fff
    style events fill:#499894,stroke:#499894,color:#fff
    style http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style runtime fill:#86BCB6,stroke:#86BCB6,color:#fff
    style testkit-vitest fill:#D4A6C8,stroke:#D4A6C8,color:#fff
    style websocket fill:#E15759,stroke:#E15759,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    linkStyle 0 stroke:#BAB0AC,stroke-width:2px
    linkStyle 1 stroke:#86BCB6,stroke-width:2px
    linkStyle 2 stroke:#8CD17D,stroke-width:2px
    linkStyle 3 stroke:#B6992D,stroke-width:2px
    linkStyle 4 stroke:#499894,stroke-width:2px
    linkStyle 5 stroke:#F28E2B,stroke-width:2px
    linkStyle 6 stroke:#86BCB6,stroke-width:2px
    linkStyle 7 stroke:#D4A6C8,stroke-width:2px
    linkStyle 8 stroke:#E15759,stroke-width:2px
    linkStyle 9 stroke:#9C755F,stroke-width:2px
```

### Discovery Kubernetes

```mermaid
flowchart TB
    subgraph Package[" "]
        discovery-kubernetes["discovery-kubernetes 🟢"]
    end
    subgraph Dependencies[" "]
        discovery["discovery 🟢"]
        logger["logger 🟢🌐"]
    end
    discovery-kubernetes --> discovery
    discovery-kubernetes --> logger
    style discovery-kubernetes fill:#BAB0AC,stroke:#BAB0AC,color:#fff
    style discovery fill:#9C755F,stroke:#9C755F,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    linkStyle 0 stroke:#BAB0AC,stroke-width:2px
    linkStyle 1 stroke:#BAB0AC,stroke-width:2px
```

### Discovery Local

```mermaid
flowchart TB
    subgraph Dependents[" "]
        runtime["runtime 🟢"]
        testkit-vitest["testkit-vitest 🟢"]
    end
    subgraph Package[" "]
        discovery-local["discovery-local 🟢"]
    end
    subgraph Dependencies[" "]
        discovery["discovery 🟢"]
        ipc["ipc 🟢"]
        locator["locator 🟢"]
        logger["logger 🟢🌐"]
        schema["schema 🟢🌐"]
    end
    runtime --> discovery-local
    testkit-vitest --> discovery-local
    discovery-local --> discovery
    discovery-local --> ipc
    discovery-local --> locator
    discovery-local --> logger
    discovery-local --> schema
    style discovery-local fill:#86BCB6,stroke:#86BCB6,color:#fff
    style runtime fill:#86BCB6,stroke:#86BCB6,color:#fff
    style testkit-vitest fill:#D4A6C8,stroke:#D4A6C8,color:#fff
    style discovery fill:#9C755F,stroke:#9C755F,color:#fff
    style ipc fill:#76B7B2,stroke:#76B7B2,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#86BCB6,stroke-width:2px
    linkStyle 1 stroke:#D4A6C8,stroke-width:2px
    linkStyle 2 stroke:#86BCB6,stroke-width:2px
    linkStyle 3 stroke:#86BCB6,stroke-width:2px
    linkStyle 4 stroke:#86BCB6,stroke-width:2px
    linkStyle 5 stroke:#86BCB6,stroke-width:2px
    linkStyle 6 stroke:#86BCB6,stroke-width:2px
```

### Discovery Migration

```mermaid
flowchart TB
    subgraph Package[" "]
        discovery-migration["discovery-migration 🟢"]
    end
    subgraph Dependencies[" "]
        discovery["discovery 🟢"]
        logger["logger 🟢🌐"]
    end
    discovery-migration --> discovery
    discovery-migration --> logger
    style discovery-migration fill:#8CD17D,stroke:#8CD17D,color:#fff
    style discovery fill:#9C755F,stroke:#9C755F,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    linkStyle 0 stroke:#8CD17D,stroke-width:2px
    linkStyle 1 stroke:#8CD17D,stroke-width:2px
```

### Discovery Static

```mermaid
flowchart TB
    subgraph Package[" "]
        discovery-static["discovery-static 🟢"]
    end
    subgraph Dependencies[" "]
        discovery["discovery 🟢"]
        logger["logger 🟢🌐"]
    end
    discovery-static --> discovery
    discovery-static --> logger
    style discovery-static fill:#B6992D,stroke:#B6992D,color:#fff
    style discovery fill:#9C755F,stroke:#9C755F,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    linkStyle 0 stroke:#B6992D,stroke-width:2px
    linkStyle 1 stroke:#B6992D,stroke-width:2px
```

### Events

```mermaid
flowchart TB
    subgraph Dependents[" "]
        events-aws["events-aws 🟢"]
        events-azure["events-azure 🟢"]
        events-gcp["events-gcp 🟢"]
    end
    subgraph Package[" "]
        events["events 🟢"]
    end
    subgraph Dependencies[" "]
        common["common 🟢🌐"]
        config["config 🟢"]
        context["context 🟢🌐"]
        discovery["discovery 🟢"]
        locator["locator 🟢"]
        logger["logger 🟢🌐"]
        metrics["metrics 🟢"]
        schema["schema 🟢🌐"]
        trace["trace 🟢🌐"]
    end
    events-aws --> events
    events-azure --> events
    events-gcp --> events
    events --> common
    events --> config
    events --> context
    events --> discovery
    events --> locator
    events --> logger
    events --> metrics
    events --> schema
    events --> trace
    style events fill:#499894,stroke:#499894,color:#fff
    style events-aws fill:#D37295,stroke:#D37295,color:#fff
    style events-azure fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style events-gcp fill:#FFBE7D,stroke:#FFBE7D,color:#fff
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    style config fill:#E15759,stroke:#E15759,color:#fff
    style context fill:#59A14F,stroke:#59A14F,color:#fff
    style discovery fill:#9C755F,stroke:#9C755F,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style metrics fill:#9C755F,stroke:#9C755F,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    style trace fill:#4E79A7,stroke:#4E79A7,color:#fff
    linkStyle 0 stroke:#D37295,stroke-width:2px
    linkStyle 1 stroke:#A0CBE8,stroke-width:2px
    linkStyle 2 stroke:#FFBE7D,stroke-width:2px
    linkStyle 3 stroke:#499894,stroke-width:2px
    linkStyle 4 stroke:#499894,stroke-width:2px
    linkStyle 5 stroke:#499894,stroke-width:2px
    linkStyle 6 stroke:#499894,stroke-width:2px
    linkStyle 7 stroke:#499894,stroke-width:2px
    linkStyle 8 stroke:#499894,stroke-width:2px
    linkStyle 9 stroke:#499894,stroke-width:2px
    linkStyle 10 stroke:#499894,stroke-width:2px
    linkStyle 11 stroke:#499894,stroke-width:2px
```

### Events Aws

```mermaid
flowchart TB
    subgraph Package[" "]
        events-aws["events-aws 🟢"]
    end
    subgraph Dependencies[" "]
        config["config 🟢"]
        events["events 🟢"]
        logger["logger 🟢🌐"]
        schema["schema 🟢🌐"]
    end
    events-aws --> config
    events-aws --> events
    events-aws --> logger
    events-aws --> schema
    style events-aws fill:#D37295,stroke:#D37295,color:#fff
    style config fill:#E15759,stroke:#E15759,color:#fff
    style events fill:#499894,stroke:#499894,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#D37295,stroke-width:2px
    linkStyle 1 stroke:#D37295,stroke-width:2px
    linkStyle 2 stroke:#D37295,stroke-width:2px
    linkStyle 3 stroke:#D37295,stroke-width:2px
```

### Events Azure

```mermaid
flowchart TB
    subgraph Package[" "]
        events-azure["events-azure 🟢"]
    end
    subgraph Dependencies[" "]
        config["config 🟢"]
        events["events 🟢"]
        logger["logger 🟢🌐"]
        schema["schema 🟢🌐"]
    end
    events-azure --> config
    events-azure --> events
    events-azure --> logger
    events-azure --> schema
    style events-azure fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style config fill:#E15759,stroke:#E15759,color:#fff
    style events fill:#499894,stroke:#499894,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#A0CBE8,stroke-width:2px
    linkStyle 1 stroke:#A0CBE8,stroke-width:2px
    linkStyle 2 stroke:#A0CBE8,stroke-width:2px
    linkStyle 3 stroke:#A0CBE8,stroke-width:2px
```

### Events Gcp

```mermaid
flowchart TB
    subgraph Package[" "]
        events-gcp["events-gcp 🟢"]
    end
    subgraph Dependencies[" "]
        config["config 🟢"]
        events["events 🟢"]
        logger["logger 🟢🌐"]
        schema["schema 🟢🌐"]
    end
    events-gcp --> config
    events-gcp --> events
    events-gcp --> logger
    events-gcp --> schema
    style events-gcp fill:#FFBE7D,stroke:#FFBE7D,color:#fff
    style config fill:#E15759,stroke:#E15759,color:#fff
    style events fill:#499894,stroke:#499894,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#FFBE7D,stroke-width:2px
    linkStyle 1 stroke:#FFBE7D,stroke-width:2px
    linkStyle 2 stroke:#FFBE7D,stroke-width:2px
    linkStyle 3 stroke:#FFBE7D,stroke-width:2px
```

### File

```mermaid
flowchart TB
    subgraph Dependents[" "]
        logger-console["logger-console 🟢"]
    end
    subgraph Package[" "]
        file["file 🟢🌐"]
    end
    subgraph Dependencies[" "]
        schema["schema 🟢🌐"]
    end
    logger-console --> file
    file --> schema
    style file fill:#D4A6C8,stroke:#D4A6C8,color:#fff
    style logger-console fill:#FF9DA7,stroke:#FF9DA7,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#FF9DA7,stroke-width:2px
    linkStyle 1 stroke:#D4A6C8,stroke-width:2px
```

### File Http

```mermaid
flowchart TB
    subgraph Package[" "]
        file-http["file-http 🟢🌐"]
    end
    subgraph Dependencies[" "]
        common["common 🟢🌐"]
        http["http 🟢🌐"]
        schema["schema 🟢🌐"]
    end
    file-http --> common
    file-http --> http
    file-http --> schema
    style file-http fill:#4E79A7,stroke:#4E79A7,color:#fff
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    style http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#4E79A7,stroke-width:2px
    linkStyle 1 stroke:#4E79A7,stroke-width:2px
    linkStyle 2 stroke:#4E79A7,stroke-width:2px
```

### Http

```mermaid
flowchart TB
    subgraph Dependents[" "]
        code-generator["code-generator 🟢"]
        file-http["file-http 🟢🌐"]
        trace-http["trace-http 🟢"]
        websocket["websocket 🟢🌐"]
    end
    subgraph Package[" "]
        http["http 🟢🌐"]
    end
    subgraph Dependencies[" "]
        common["common 🟢🌐"]
        context["context 🟢🌐"]
        discovery["discovery 🟢"]
        locator["locator 🟢"]
        logger["logger 🟢🌐"]
        metrics["metrics 🟢"]
        schema["schema 🟢🌐"]
        trace["trace 🟢🌐"]
    end
    code-generator --> http
    file-http --> http
    trace-http --> http
    websocket --> http
    http --> common
    http --> context
    http --> discovery
    http --> locator
    http --> logger
    http --> metrics
    http --> schema
    http --> trace
    style http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style code-generator fill:#4E79A7,stroke:#4E79A7,color:#fff
    style file-http fill:#4E79A7,stroke:#4E79A7,color:#fff
    style trace-http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style websocket fill:#E15759,stroke:#E15759,color:#fff
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    style context fill:#59A14F,stroke:#59A14F,color:#fff
    style discovery fill:#9C755F,stroke:#9C755F,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style metrics fill:#9C755F,stroke:#9C755F,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    style trace fill:#4E79A7,stroke:#4E79A7,color:#fff
    linkStyle 0 stroke:#4E79A7,stroke-width:2px
    linkStyle 1 stroke:#4E79A7,stroke-width:2px
    linkStyle 2 stroke:#F28E2B,stroke-width:2px
    linkStyle 3 stroke:#E15759,stroke-width:2px
    linkStyle 4 stroke:#F28E2B,stroke-width:2px
    linkStyle 5 stroke:#F28E2B,stroke-width:2px
    linkStyle 6 stroke:#F28E2B,stroke-width:2px
    linkStyle 7 stroke:#F28E2B,stroke-width:2px
    linkStyle 8 stroke:#F28E2B,stroke-width:2px
    linkStyle 9 stroke:#F28E2B,stroke-width:2px
    linkStyle 10 stroke:#F28E2B,stroke-width:2px
    linkStyle 11 stroke:#F28E2B,stroke-width:2px
```

### Intl

```mermaid
flowchart TB
    subgraph Package[" "]
        intl["intl 🟢🌐"]
    end
    subgraph Dependencies[" "]
        context["context 🟢🌐"]
        locator["locator 🟢"]
        schema["schema 🟢🌐"]
    end
    intl --> context
    intl --> locator
    intl --> schema
    style intl fill:#E15759,stroke:#E15759,color:#fff
    style context fill:#59A14F,stroke:#59A14F,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#E15759,stroke-width:2px
    linkStyle 1 stroke:#E15759,stroke-width:2px
    linkStyle 2 stroke:#E15759,stroke-width:2px
```

### Ipc

```mermaid
flowchart TB
    subgraph Dependents[" "]
        discovery-local["discovery-local 🟢"]
        testkit["testkit 🟢"]
        testkit-vitest["testkit-vitest 🟢"]
    end
    subgraph Package[" "]
        ipc["ipc 🟢"]
    end
    subgraph Dependencies[" "]
        common["common 🟢🌐"]
        context["context 🟢🌐"]
        locator["locator 🟢"]
        logger["logger 🟢🌐"]
        trace["trace 🟢🌐"]
    end
    discovery-local --> ipc
    testkit --> ipc
    testkit-vitest --> ipc
    ipc --> common
    ipc --> context
    ipc --> locator
    ipc --> logger
    ipc --> trace
    style ipc fill:#76B7B2,stroke:#76B7B2,color:#fff
    style discovery-local fill:#86BCB6,stroke:#86BCB6,color:#fff
    style testkit fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style testkit-vitest fill:#D4A6C8,stroke:#D4A6C8,color:#fff
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    style context fill:#59A14F,stroke:#59A14F,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style trace fill:#4E79A7,stroke:#4E79A7,color:#fff
    linkStyle 0 stroke:#86BCB6,stroke-width:2px
    linkStyle 1 stroke:#A0CBE8,stroke-width:2px
    linkStyle 2 stroke:#D4A6C8,stroke-width:2px
    linkStyle 3 stroke:#76B7B2,stroke-width:2px
    linkStyle 4 stroke:#76B7B2,stroke-width:2px
    linkStyle 5 stroke:#76B7B2,stroke-width:2px
    linkStyle 6 stroke:#76B7B2,stroke-width:2px
    linkStyle 7 stroke:#76B7B2,stroke-width:2px
```

### Locator

```mermaid
flowchart TB
    subgraph Dependents[" "]
        config["config 🟢"]
        db-mysql["db-mysql 🟢"]
        db-postgre["db-postgre 🟢"]
        discovery["discovery 🟢"]
        discovery-local["discovery-local 🟢"]
        events["events 🟢"]
        http["http 🟢🌐"]
        intl["intl 🟢🌐"]
        ipc["ipc 🟢"]
        lock["lock 🟢"]
        logger["logger 🟢🌐"]
        metrics["metrics 🟢"]
        poller["poller 🟢"]
        runtime["runtime 🟢"]
        testkit["testkit 🟢"]
        testkit-runtime["testkit-runtime 🟢"]
        testkit-vitest["testkit-vitest 🟢"]
        websocket["websocket 🟢🌐"]
    end
    subgraph Package[" "]
        locator["locator 🟢"]
    end
    subgraph Dependencies[" "]
        common["common 🟢🌐"]
    end
    config --> locator
    db-mysql --> locator
    db-postgre --> locator
    discovery --> locator
    discovery-local --> locator
    events --> locator
    http --> locator
    intl --> locator
    ipc --> locator
    lock --> locator
    logger --> locator
    metrics --> locator
    poller --> locator
    runtime --> locator
    testkit --> locator
    testkit-runtime --> locator
    testkit-vitest --> locator
    websocket --> locator
    locator --> common
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style config fill:#E15759,stroke:#E15759,color:#fff
    style db-mysql fill:#B07AA1,stroke:#B07AA1,color:#fff
    style db-postgre fill:#FF9DA7,stroke:#FF9DA7,color:#fff
    style discovery fill:#9C755F,stroke:#9C755F,color:#fff
    style discovery-local fill:#86BCB6,stroke:#86BCB6,color:#fff
    style events fill:#499894,stroke:#499894,color:#fff
    style http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style intl fill:#E15759,stroke:#E15759,color:#fff
    style ipc fill:#76B7B2,stroke:#76B7B2,color:#fff
    style lock fill:#EDC948,stroke:#EDC948,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style metrics fill:#9C755F,stroke:#9C755F,color:#fff
    style poller fill:#BAB0AC,stroke:#BAB0AC,color:#fff
    style runtime fill:#86BCB6,stroke:#86BCB6,color:#fff
    style testkit fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style testkit-runtime fill:#FFBE7D,stroke:#FFBE7D,color:#fff
    style testkit-vitest fill:#D4A6C8,stroke:#D4A6C8,color:#fff
    style websocket fill:#E15759,stroke:#E15759,color:#fff
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    linkStyle 0 stroke:#E15759,stroke-width:2px
    linkStyle 1 stroke:#B07AA1,stroke-width:2px
    linkStyle 2 stroke:#FF9DA7,stroke-width:2px
    linkStyle 3 stroke:#9C755F,stroke-width:2px
    linkStyle 4 stroke:#86BCB6,stroke-width:2px
    linkStyle 5 stroke:#499894,stroke-width:2px
    linkStyle 6 stroke:#F28E2B,stroke-width:2px
    linkStyle 7 stroke:#E15759,stroke-width:2px
    linkStyle 8 stroke:#76B7B2,stroke-width:2px
    linkStyle 9 stroke:#EDC948,stroke-width:2px
    linkStyle 10 stroke:#B07AA1,stroke-width:2px
    linkStyle 11 stroke:#9C755F,stroke-width:2px
    linkStyle 12 stroke:#BAB0AC,stroke-width:2px
    linkStyle 13 stroke:#86BCB6,stroke-width:2px
    linkStyle 14 stroke:#A0CBE8,stroke-width:2px
    linkStyle 15 stroke:#FFBE7D,stroke-width:2px
    linkStyle 16 stroke:#D4A6C8,stroke-width:2px
    linkStyle 17 stroke:#E15759,stroke-width:2px
    linkStyle 18 stroke:#59A14F,stroke-width:2px
```

### Lock

```mermaid
flowchart TB
    subgraph Dependents[" "]
        poller["poller 🟢"]
    end
    subgraph Package[" "]
        lock["lock 🟢"]
    end
    subgraph Dependencies[" "]
        locator["locator 🟢"]
    end
    poller --> lock
    lock --> locator
    style lock fill:#EDC948,stroke:#EDC948,color:#fff
    style poller fill:#BAB0AC,stroke:#BAB0AC,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    linkStyle 0 stroke:#BAB0AC,stroke-width:2px
    linkStyle 1 stroke:#EDC948,stroke-width:2px
```

### Logger

```mermaid
flowchart TB
    subgraph Dependents[" "]
        db-mysql["db-mysql 🟢"]
        db-postgre["db-postgre 🟢"]
        discovery-kubernetes["discovery-kubernetes 🟢"]
        discovery-local["discovery-local 🟢"]
        discovery-migration["discovery-migration 🟢"]
        discovery-static["discovery-static 🟢"]
        events["events 🟢"]
        events-aws["events-aws 🟢"]
        events-azure["events-azure 🟢"]
        events-gcp["events-gcp 🟢"]
        http["http 🟢🌐"]
        ipc["ipc 🟢"]
        logger-console["logger-console 🟢"]
        runtime["runtime 🟢"]
        testkit["testkit 🟢"]
        testkit-vitest["testkit-vitest 🟢"]
        websocket["websocket 🟢🌐"]
    end
    subgraph Package[" "]
        logger["logger 🟢🌐"]
    end
    subgraph Dependencies[" "]
        locator["locator 🟢"]
    end
    db-mysql --> logger
    db-postgre --> logger
    discovery-kubernetes --> logger
    discovery-local --> logger
    discovery-migration --> logger
    discovery-static --> logger
    events --> logger
    events-aws --> logger
    events-azure --> logger
    events-gcp --> logger
    http --> logger
    ipc --> logger
    logger-console --> logger
    runtime --> logger
    testkit --> logger
    testkit-vitest --> logger
    websocket --> logger
    logger --> locator
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style db-mysql fill:#B07AA1,stroke:#B07AA1,color:#fff
    style db-postgre fill:#FF9DA7,stroke:#FF9DA7,color:#fff
    style discovery-kubernetes fill:#BAB0AC,stroke:#BAB0AC,color:#fff
    style discovery-local fill:#86BCB6,stroke:#86BCB6,color:#fff
    style discovery-migration fill:#8CD17D,stroke:#8CD17D,color:#fff
    style discovery-static fill:#B6992D,stroke:#B6992D,color:#fff
    style events fill:#499894,stroke:#499894,color:#fff
    style events-aws fill:#D37295,stroke:#D37295,color:#fff
    style events-azure fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style events-gcp fill:#FFBE7D,stroke:#FFBE7D,color:#fff
    style http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style ipc fill:#76B7B2,stroke:#76B7B2,color:#fff
    style logger-console fill:#FF9DA7,stroke:#FF9DA7,color:#fff
    style runtime fill:#86BCB6,stroke:#86BCB6,color:#fff
    style testkit fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style testkit-vitest fill:#D4A6C8,stroke:#D4A6C8,color:#fff
    style websocket fill:#E15759,stroke:#E15759,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    linkStyle 0 stroke:#B07AA1,stroke-width:2px
    linkStyle 1 stroke:#FF9DA7,stroke-width:2px
    linkStyle 2 stroke:#BAB0AC,stroke-width:2px
    linkStyle 3 stroke:#86BCB6,stroke-width:2px
    linkStyle 4 stroke:#8CD17D,stroke-width:2px
    linkStyle 5 stroke:#B6992D,stroke-width:2px
    linkStyle 6 stroke:#499894,stroke-width:2px
    linkStyle 7 stroke:#D37295,stroke-width:2px
    linkStyle 8 stroke:#A0CBE8,stroke-width:2px
    linkStyle 9 stroke:#FFBE7D,stroke-width:2px
    linkStyle 10 stroke:#F28E2B,stroke-width:2px
    linkStyle 11 stroke:#76B7B2,stroke-width:2px
    linkStyle 12 stroke:#FF9DA7,stroke-width:2px
    linkStyle 13 stroke:#86BCB6,stroke-width:2px
    linkStyle 14 stroke:#A0CBE8,stroke-width:2px
    linkStyle 15 stroke:#D4A6C8,stroke-width:2px
    linkStyle 16 stroke:#E15759,stroke-width:2px
    linkStyle 17 stroke:#B07AA1,stroke-width:2px
```

### Logger Console

```mermaid
flowchart TB
    subgraph Dependents[" "]
        testkit["testkit 🟢"]
        testkit-vitest["testkit-vitest 🟢"]
    end
    subgraph Package[" "]
        logger-console["logger-console 🟢"]
    end
    subgraph Dependencies[" "]
        file["file 🟢🌐"]
        logger["logger 🟢🌐"]
        schema["schema 🟢🌐"]
    end
    testkit --> logger-console
    testkit-vitest --> logger-console
    logger-console --> file
    logger-console --> logger
    logger-console --> schema
    style logger-console fill:#FF9DA7,stroke:#FF9DA7,color:#fff
    style testkit fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style testkit-vitest fill:#D4A6C8,stroke:#D4A6C8,color:#fff
    style file fill:#D4A6C8,stroke:#D4A6C8,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#A0CBE8,stroke-width:2px
    linkStyle 1 stroke:#D4A6C8,stroke-width:2px
    linkStyle 2 stroke:#FF9DA7,stroke-width:2px
    linkStyle 3 stroke:#FF9DA7,stroke-width:2px
    linkStyle 4 stroke:#FF9DA7,stroke-width:2px
```

### Metrics

```mermaid
flowchart TB
    subgraph Dependents[" "]
        events["events 🟢"]
        http["http 🟢🌐"]
        poller["poller 🟢"]
        runtime["runtime 🟢"]
        websocket["websocket 🟢🌐"]
    end
    subgraph Package[" "]
        metrics["metrics 🟢"]
    end
    subgraph Dependencies[" "]
        common["common 🟢🌐"]
        locator["locator 🟢"]
    end
    events --> metrics
    http --> metrics
    poller --> metrics
    runtime --> metrics
    websocket --> metrics
    metrics --> common
    metrics --> locator
    style metrics fill:#9C755F,stroke:#9C755F,color:#fff
    style events fill:#499894,stroke:#499894,color:#fff
    style http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style poller fill:#BAB0AC,stroke:#BAB0AC,color:#fff
    style runtime fill:#86BCB6,stroke:#86BCB6,color:#fff
    style websocket fill:#E15759,stroke:#E15759,color:#fff
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    linkStyle 0 stroke:#499894,stroke-width:2px
    linkStyle 1 stroke:#F28E2B,stroke-width:2px
    linkStyle 2 stroke:#BAB0AC,stroke-width:2px
    linkStyle 3 stroke:#86BCB6,stroke-width:2px
    linkStyle 4 stroke:#E15759,stroke-width:2px
    linkStyle 5 stroke:#9C755F,stroke-width:2px
    linkStyle 6 stroke:#9C755F,stroke-width:2px
```

### Poller

```mermaid
flowchart TB
    subgraph Package[" "]
        poller["poller 🟢"]
    end
    subgraph Dependencies[" "]
        config["config 🟢"]
        locator["locator 🟢"]
        lock["lock 🟢"]
        metrics["metrics 🟢"]
        schema["schema 🟢🌐"]
    end
    poller --> config
    poller --> locator
    poller --> lock
    poller --> metrics
    poller --> schema
    style poller fill:#BAB0AC,stroke:#BAB0AC,color:#fff
    style config fill:#E15759,stroke:#E15759,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style lock fill:#EDC948,stroke:#EDC948,color:#fff
    style metrics fill:#9C755F,stroke:#9C755F,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#BAB0AC,stroke-width:2px
    linkStyle 1 stroke:#BAB0AC,stroke-width:2px
    linkStyle 2 stroke:#BAB0AC,stroke-width:2px
    linkStyle 3 stroke:#BAB0AC,stroke-width:2px
    linkStyle 4 stroke:#BAB0AC,stroke-width:2px
```

### Runtime

```mermaid
flowchart TB
    subgraph Dependents[" "]
        testkit["testkit 🟢"]
    end
    subgraph Package[" "]
        runtime["runtime 🟢"]
    end
    subgraph Dependencies[" "]
        common["common 🟢🌐"]
        context["context 🟢🌐"]
        discovery["discovery 🟢"]
        discovery-local["discovery-local 🟢"]
        locator["locator 🟢"]
        logger["logger 🟢🌐"]
        metrics["metrics 🟢"]
        trace["trace 🟢🌐"]
    end
    testkit --> runtime
    runtime --> common
    runtime --> context
    runtime --> discovery
    runtime --> discovery-local
    runtime --> locator
    runtime --> logger
    runtime --> metrics
    runtime --> trace
    style runtime fill:#86BCB6,stroke:#86BCB6,color:#fff
    style testkit fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    style context fill:#59A14F,stroke:#59A14F,color:#fff
    style discovery fill:#9C755F,stroke:#9C755F,color:#fff
    style discovery-local fill:#86BCB6,stroke:#86BCB6,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style metrics fill:#9C755F,stroke:#9C755F,color:#fff
    style trace fill:#4E79A7,stroke:#4E79A7,color:#fff
    linkStyle 0 stroke:#A0CBE8,stroke-width:2px
    linkStyle 1 stroke:#86BCB6,stroke-width:2px
    linkStyle 2 stroke:#86BCB6,stroke-width:2px
    linkStyle 3 stroke:#86BCB6,stroke-width:2px
    linkStyle 4 stroke:#86BCB6,stroke-width:2px
    linkStyle 5 stroke:#86BCB6,stroke-width:2px
    linkStyle 6 stroke:#86BCB6,stroke-width:2px
    linkStyle 7 stroke:#86BCB6,stroke-width:2px
    linkStyle 8 stroke:#86BCB6,stroke-width:2px
```

### Schema

```mermaid
flowchart TB
    subgraph Dependents[" "]
        config["config 🟢"]
        context["context 🟢🌐"]
        db-mysql["db-mysql 🟢"]
        db-postgre["db-postgre 🟢"]
        discovery-local["discovery-local 🟢"]
        events["events 🟢"]
        events-aws["events-aws 🟢"]
        events-azure["events-azure 🟢"]
        events-gcp["events-gcp 🟢"]
        file["file 🟢🌐"]
        file-http["file-http 🟢🌐"]
        http["http 🟢🌐"]
        intl["intl 🟢🌐"]
        logger-console["logger-console 🟢"]
        poller["poller 🟢"]
        schema-benchmark["schema-benchmark 🟢"]
        sql["sql 🟢"]
        testkit["testkit 🟢"]
        trace["trace 🟢🌐"]
        websocket["websocket 🟢🌐"]
    end
    subgraph Package[" "]
        schema["schema 🟢🌐"]
    end
    config --> schema
    context --> schema
    db-mysql --> schema
    db-postgre --> schema
    discovery-local --> schema
    events --> schema
    events-aws --> schema
    events-azure --> schema
    events-gcp --> schema
    file --> schema
    file-http --> schema
    http --> schema
    intl --> schema
    logger-console --> schema
    poller --> schema
    schema-benchmark --> schema
    sql --> schema
    testkit --> schema
    trace --> schema
    websocket --> schema
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    style config fill:#E15759,stroke:#E15759,color:#fff
    style context fill:#59A14F,stroke:#59A14F,color:#fff
    style db-mysql fill:#B07AA1,stroke:#B07AA1,color:#fff
    style db-postgre fill:#FF9DA7,stroke:#FF9DA7,color:#fff
    style discovery-local fill:#86BCB6,stroke:#86BCB6,color:#fff
    style events fill:#499894,stroke:#499894,color:#fff
    style events-aws fill:#D37295,stroke:#D37295,color:#fff
    style events-azure fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style events-gcp fill:#FFBE7D,stroke:#FFBE7D,color:#fff
    style file fill:#D4A6C8,stroke:#D4A6C8,color:#fff
    style file-http fill:#4E79A7,stroke:#4E79A7,color:#fff
    style http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style intl fill:#E15759,stroke:#E15759,color:#fff
    style logger-console fill:#FF9DA7,stroke:#FF9DA7,color:#fff
    style poller fill:#BAB0AC,stroke:#BAB0AC,color:#fff
    style schema-benchmark fill:#B6992D,stroke:#B6992D,color:#fff
    style sql fill:#499894,stroke:#499894,color:#fff
    style testkit fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style trace fill:#4E79A7,stroke:#4E79A7,color:#fff
    style websocket fill:#E15759,stroke:#E15759,color:#fff
    linkStyle 0 stroke:#E15759,stroke-width:2px
    linkStyle 1 stroke:#59A14F,stroke-width:2px
    linkStyle 2 stroke:#B07AA1,stroke-width:2px
    linkStyle 3 stroke:#FF9DA7,stroke-width:2px
    linkStyle 4 stroke:#86BCB6,stroke-width:2px
    linkStyle 5 stroke:#499894,stroke-width:2px
    linkStyle 6 stroke:#D37295,stroke-width:2px
    linkStyle 7 stroke:#A0CBE8,stroke-width:2px
    linkStyle 8 stroke:#FFBE7D,stroke-width:2px
    linkStyle 9 stroke:#D4A6C8,stroke-width:2px
    linkStyle 10 stroke:#4E79A7,stroke-width:2px
    linkStyle 11 stroke:#F28E2B,stroke-width:2px
    linkStyle 12 stroke:#E15759,stroke-width:2px
    linkStyle 13 stroke:#FF9DA7,stroke-width:2px
    linkStyle 14 stroke:#BAB0AC,stroke-width:2px
    linkStyle 15 stroke:#B6992D,stroke-width:2px
    linkStyle 16 stroke:#499894,stroke-width:2px
    linkStyle 17 stroke:#A0CBE8,stroke-width:2px
    linkStyle 18 stroke:#4E79A7,stroke-width:2px
    linkStyle 19 stroke:#E15759,stroke-width:2px
```

### Schema Benchmark

```mermaid
flowchart TB
    subgraph Package[" "]
        schema-benchmark["schema-benchmark 🟢"]
    end
    subgraph Dependencies[" "]
        schema["schema 🟢🌐"]
    end
    schema-benchmark --> schema
    style schema-benchmark fill:#B6992D,stroke:#B6992D,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#B6992D,stroke-width:2px
```

### Sql

```mermaid
flowchart TB
    subgraph Package[" "]
        sql["sql 🟢"]
    end
    subgraph Dependencies[" "]
        schema["schema 🟢🌐"]
    end
    sql --> schema
    style sql fill:#499894,stroke:#499894,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#499894,stroke-width:2px
```

### Struct

```mermaid
flowchart TB
    subgraph Package[" "]
        struct["struct 🟢"]
    end
    style struct fill:#D37295,stroke:#D37295,color:#fff
```

### Testkit

```mermaid
flowchart TB
    subgraph Dependents[" "]
        testkit-vitest["testkit-vitest 🟢"]
    end
    subgraph Package[" "]
        testkit["testkit 🟢"]
    end
    subgraph Dependencies[" "]
        common["common 🟢🌐"]
        context["context 🟢🌐"]
        ipc["ipc 🟢"]
        locator["locator 🟢"]
        logger["logger 🟢🌐"]
        logger-console["logger-console 🟢"]
        runtime["runtime 🟢"]
        schema["schema 🟢🌐"]
        testkit-runtime["testkit-runtime 🟢"]
        trace["trace 🟢🌐"]
    end
    testkit-vitest --> testkit
    testkit --> common
    testkit --> context
    testkit --> ipc
    testkit --> locator
    testkit --> logger
    testkit --> logger-console
    testkit --> runtime
    testkit --> schema
    testkit --> testkit-runtime
    testkit --> trace
    style testkit fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style testkit-vitest fill:#D4A6C8,stroke:#D4A6C8,color:#fff
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    style context fill:#59A14F,stroke:#59A14F,color:#fff
    style ipc fill:#76B7B2,stroke:#76B7B2,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style logger-console fill:#FF9DA7,stroke:#FF9DA7,color:#fff
    style runtime fill:#86BCB6,stroke:#86BCB6,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    style testkit-runtime fill:#FFBE7D,stroke:#FFBE7D,color:#fff
    style trace fill:#4E79A7,stroke:#4E79A7,color:#fff
    linkStyle 0 stroke:#D4A6C8,stroke-width:2px
    linkStyle 1 stroke:#A0CBE8,stroke-width:2px
    linkStyle 2 stroke:#A0CBE8,stroke-width:2px
    linkStyle 3 stroke:#A0CBE8,stroke-width:2px
    linkStyle 4 stroke:#A0CBE8,stroke-width:2px
    linkStyle 5 stroke:#A0CBE8,stroke-width:2px
    linkStyle 6 stroke:#A0CBE8,stroke-width:2px
    linkStyle 7 stroke:#A0CBE8,stroke-width:2px
    linkStyle 8 stroke:#A0CBE8,stroke-width:2px
    linkStyle 9 stroke:#A0CBE8,stroke-width:2px
    linkStyle 10 stroke:#A0CBE8,stroke-width:2px
```

### Testkit Runtime

```mermaid
flowchart TB
    subgraph Dependents[" "]
        testkit["testkit 🟢"]
    end
    subgraph Package[" "]
        testkit-runtime["testkit-runtime 🟢"]
    end
    subgraph Dependencies[" "]
        locator["locator 🟢"]
    end
    testkit --> testkit-runtime
    testkit-runtime --> locator
    style testkit-runtime fill:#FFBE7D,stroke:#FFBE7D,color:#fff
    style testkit fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    linkStyle 0 stroke:#A0CBE8,stroke-width:2px
    linkStyle 1 stroke:#FFBE7D,stroke-width:2px
```

### Testkit Vitest

```mermaid
flowchart TB
    subgraph Package[" "]
        testkit-vitest["testkit-vitest 🟢"]
    end
    subgraph Dependencies[" "]
        common["common 🟢🌐"]
        discovery["discovery 🟢"]
        discovery-local["discovery-local 🟢"]
        ipc["ipc 🟢"]
        locator["locator 🟢"]
        logger["logger 🟢🌐"]
        logger-console["logger-console 🟢"]
        testkit["testkit 🟢"]
    end
    testkit-vitest --> common
    testkit-vitest --> discovery
    testkit-vitest --> discovery-local
    testkit-vitest --> ipc
    testkit-vitest --> locator
    testkit-vitest --> logger
    testkit-vitest --> logger-console
    testkit-vitest --> testkit
    style testkit-vitest fill:#D4A6C8,stroke:#D4A6C8,color:#fff
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    style discovery fill:#9C755F,stroke:#9C755F,color:#fff
    style discovery-local fill:#86BCB6,stroke:#86BCB6,color:#fff
    style ipc fill:#76B7B2,stroke:#76B7B2,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style logger-console fill:#FF9DA7,stroke:#FF9DA7,color:#fff
    style testkit fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    linkStyle 0 stroke:#D4A6C8,stroke-width:2px
    linkStyle 1 stroke:#D4A6C8,stroke-width:2px
    linkStyle 2 stroke:#D4A6C8,stroke-width:2px
    linkStyle 3 stroke:#D4A6C8,stroke-width:2px
    linkStyle 4 stroke:#D4A6C8,stroke-width:2px
    linkStyle 5 stroke:#D4A6C8,stroke-width:2px
    linkStyle 6 stroke:#D4A6C8,stroke-width:2px
    linkStyle 7 stroke:#D4A6C8,stroke-width:2px
```

### Trace

```mermaid
flowchart TB
    subgraph Dependents[" "]
        events["events 🟢"]
        http["http 🟢🌐"]
        ipc["ipc 🟢"]
        runtime["runtime 🟢"]
        testkit["testkit 🟢"]
        trace-http["trace-http 🟢"]
        websocket["websocket 🟢🌐"]
    end
    subgraph Package[" "]
        trace["trace 🟢🌐"]
    end
    subgraph Dependencies[" "]
        context["context 🟢🌐"]
        schema["schema 🟢🌐"]
    end
    events --> trace
    http --> trace
    ipc --> trace
    runtime --> trace
    testkit --> trace
    trace-http --> trace
    websocket --> trace
    trace --> context
    trace --> schema
    style trace fill:#4E79A7,stroke:#4E79A7,color:#fff
    style events fill:#499894,stroke:#499894,color:#fff
    style http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style ipc fill:#76B7B2,stroke:#76B7B2,color:#fff
    style runtime fill:#86BCB6,stroke:#86BCB6,color:#fff
    style testkit fill:#A0CBE8,stroke:#A0CBE8,color:#fff
    style trace-http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style websocket fill:#E15759,stroke:#E15759,color:#fff
    style context fill:#59A14F,stroke:#59A14F,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    linkStyle 0 stroke:#499894,stroke-width:2px
    linkStyle 1 stroke:#F28E2B,stroke-width:2px
    linkStyle 2 stroke:#76B7B2,stroke-width:2px
    linkStyle 3 stroke:#86BCB6,stroke-width:2px
    linkStyle 4 stroke:#A0CBE8,stroke-width:2px
    linkStyle 5 stroke:#F28E2B,stroke-width:2px
    linkStyle 6 stroke:#E15759,stroke-width:2px
    linkStyle 7 stroke:#4E79A7,stroke-width:2px
    linkStyle 8 stroke:#4E79A7,stroke-width:2px
```

### Trace Http

```mermaid
flowchart TB
    subgraph Package[" "]
        trace-http["trace-http 🟢"]
    end
    subgraph Dependencies[" "]
        http["http 🟢🌐"]
        trace["trace 🟢🌐"]
    end
    trace-http --> http
    trace-http --> trace
    style trace-http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style trace fill:#4E79A7,stroke:#4E79A7,color:#fff
    linkStyle 0 stroke:#F28E2B,stroke-width:2px
    linkStyle 1 stroke:#F28E2B,stroke-width:2px
```

### Websocket

```mermaid
flowchart TB
    subgraph Package[" "]
        websocket["websocket 🟢🌐"]
    end
    subgraph Dependencies[" "]
        common["common 🟢🌐"]
        context["context 🟢🌐"]
        discovery["discovery 🟢"]
        http["http 🟢🌐"]
        locator["locator 🟢"]
        logger["logger 🟢🌐"]
        metrics["metrics 🟢"]
        schema["schema 🟢🌐"]
        trace["trace 🟢🌐"]
    end
    websocket --> common
    websocket --> context
    websocket --> discovery
    websocket --> http
    websocket --> locator
    websocket --> logger
    websocket --> metrics
    websocket --> schema
    websocket --> trace
    style websocket fill:#E15759,stroke:#E15759,color:#fff
    style common fill:#F28E2B,stroke:#F28E2B,color:#fff
    style context fill:#59A14F,stroke:#59A14F,color:#fff
    style discovery fill:#9C755F,stroke:#9C755F,color:#fff
    style http fill:#F28E2B,stroke:#F28E2B,color:#fff
    style locator fill:#59A14F,stroke:#59A14F,color:#fff
    style logger fill:#B07AA1,stroke:#B07AA1,color:#fff
    style metrics fill:#9C755F,stroke:#9C755F,color:#fff
    style schema fill:#8CD17D,stroke:#8CD17D,color:#fff
    style trace fill:#4E79A7,stroke:#4E79A7,color:#fff
    linkStyle 0 stroke:#E15759,stroke-width:2px
    linkStyle 1 stroke:#E15759,stroke-width:2px
    linkStyle 2 stroke:#E15759,stroke-width:2px
    linkStyle 3 stroke:#E15759,stroke-width:2px
    linkStyle 4 stroke:#E15759,stroke-width:2px
    linkStyle 5 stroke:#E15759,stroke-width:2px
    linkStyle 6 stroke:#E15759,stroke-width:2px
    linkStyle 7 stroke:#E15759,stroke-width:2px
    linkStyle 8 stroke:#E15759,stroke-width:2px
```

### X Packager

```mermaid
flowchart TB
    subgraph Package[" "]
        x-packager["x-packager 🟢"]
    end
    style x-packager fill:#76B7B2,stroke:#76B7B2,color:#fff
```
