# Local and Live Config

This guide explains how to use `@grest-ts/config` in a real project: hardcoded local values during development and testing, live secrets from AWS during production — all with the same runtime code.

## The Pattern

The core idea is simple: `GGConfigLocator` accepts an optional `localConfig` argument. When present, it automatically substitutes `GGConfigStoreLocal` for any configured stores **outside of production** (`NODE_ENV !== 'production'`). In production the real stores take over. You write the wiring once.

```typescript
// src/AppRuntime.ts
import {GGConfigLocator, GGSecret, GGResource} from "@grest-ts/config"
import {GGConfigStoreAwsSecretsManager} from "@grest-ts/config-aws"
import {RealestateConfig} from "./RealestateConfig"
import {localConfig} from "./config/local"

export class AppRuntime extends GGRuntime {
    protected compose(): void {
        new GGConfigLocator(RealestateConfig, localConfig)
            .add([GGSecret, GGResource], new GGConfigStoreAwsSecretsManager({
                secretName: "realestate/prod",
                region: "eu-west-1",
            }))
    }
}
```

That is the whole production-vs-local switch. No `if/else`, no environment checks scattered through your code.

## Creating the Local Config

Put your local values in a separate file (conventionally `src/config/local.ts`). Use `createLocalConfig` — it type-checks every value against your config definition at compile time, so a missing or mistyped field is a build error, not a runtime surprise.

```typescript
// src/config/local.ts
import {createLocalConfig} from "@grest-ts/config"
import {RealestateConfig} from "../RealestateConfig"

const aws = {endpoint: "http://localhost:4566", region: "eu-central-1"}
const awsCredentials = {accessKeyId: "test", secretAccessKey: "test"}

const localConfig = createLocalConfig(RealestateConfig, {
    appUrl: "http://localhost:3000",

    mysql: {
        host: {host: "localhost", port: 3300, database: "realestate"},
        user: {username: "root", password: ""},
    },

    s3Uploads: {
        resource: {bucket: "realestate-uploads", forcePathStyle: true, ...aws},
        credentials: awsCredentials,
    },
    s3Expenses: {
        resource: {bucket: "realestate-expenses", forcePathStyle: true, ...aws},
        credentials: awsCredentials,
    },
    s3Emails: {
        resource: {bucket: "realestate-emails", forcePathStyle: true, ...aws},
        credentials: awsCredentials,
    },

    sqsExpenseEmails: {
        resource: {
            queueUrl: "expense-emails",
            maxNumberOfMessages: 10,
            waitTimeSeconds: 20,
            nextRequestSleepMs: 1000,
            ...aws,
        },
        credentials: awsCredentials,
    },

    ses: {
        resource: aws,
        credentials: awsCredentials,
    },

    userJwtSecret: "dev-user-secret",
    companyJwtSecret: "dev-company-secret",
    costPocketApiKey: "dev-api-key",

    lhv: {
        clientCode: "11456950",
        clientCountry: "EE",
        privateKey: "dev-private-key",
        certificate: "dev-certificate",
    },
})

export {localConfig}
```

`createLocalConfig` returns a plain object. It does not connect to anything, it does not read environment variables, and it cannot start in production — `GGConfigStoreLocal` will throw immediately if `NODE_ENV=production`.

## How the Switch Works

When you pass `localConfig` to `GGConfigLocator`:

- **Development / test** (`NODE_ENV` is anything other than `'production'`): the locator ignores the `.add(...)` stores you registered and reads every secret and resource from your local config object instead.
- **Production** (`NODE_ENV=production`): the locator ignores `localConfig` entirely and reads from the stores you registered (AWS Secrets Manager in the example above).

`GGSetting` values always come from their registered store (e.g. `GGConfigStoreFile`) regardless of environment, because settings are meant to be tunable at runtime — they are not secrets.

## Alternative: Explicit if/else

If the automatic switch does not fit your situation — for example, you are running integration tests against a staging AWS account, or you want to be explicit about which store is active — you can build the locator conditionally:

```typescript
import {GGConfigLocator, GGSecret, GGResource, GGConfigStoreLocal} from "@grest-ts/config"
import {GGConfigStoreAwsSecretsManager} from "@grest-ts/config-aws"
import {RealestateConfig} from "./RealestateConfig"
import {localConfig} from "./config/local"

const isProduction = process.env.NODE_ENV === "production"

const locator = new GGConfigLocator(RealestateConfig)

if (isProduction) {
    locator.add([GGSecret, GGResource], new GGConfigStoreAwsSecretsManager({
        secretName: "realestate/prod",
        region: "eu-west-1",
    }))
} else {
    locator.add([GGSecret, GGResource], new GGConfigStoreLocal(RealestateConfig, localConfig))
}
```

This is equivalent to the shorthand form above, but fully explicit. Prefer the shorthand (`new GGConfigLocator(config, localConfig)`) for the common case.

## Keeping Secrets Out of Version Control

The local config file often contains passwords and API keys that must not be committed. Two common approaches:

**Option 1 — gitignore the file and document it.** Add `src/config/local.ts` to `.gitignore` and provide a `local.ts.example` file with placeholder values that _is_ committed.

**Option 2 — Use obviously fake values and rely on `GGConfigStoreLocal` refusing to start in production.** Because `GGConfigStoreLocal` throws at startup when `NODE_ENV=production`, a locally committed file with dummy secrets cannot accidentally reach a production system. This approach trades a small risk (a developer copy-pastes a real key as a placeholder) for a simpler workflow (no `.example` dance). Use your team's judgement.

## Sharing AWS Config Across Services

For a multi-service project, `awsCredentials` and `aws` (the endpoint object) are typically shared constants defined once and spread into every service config that needs them:

```typescript
// config/shared.ts
export const localAwsEndpoint = {
    endpoint: "http://localhost:4566",
    region: "eu-central-1",
}

export const localAwsCredentials = {
    accessKeyId: "test",
    secretAccessKey: "test",
}
```

```typescript
// service-a/config/local.ts
import {localAwsEndpoint, localAwsCredentials} from "../../config/shared"
// ... spread into each service's createLocalConfig call
```

## Type Safety

`createLocalConfig` requires that the value object you pass is assignable to the config's value type. If your `RealestateConfig` gains a new `GGSecret` field and you forget to add it to the local config, TypeScript reports an error immediately — not at runtime.

Secrets and resources do not have default values. If a key is missing from both the store and the local config, the locator fails to start with a clear message naming the missing key.

## See Also

- [@grest-ts/config](/packages/config) — key types, `GGConfigLocator`, `createLocalConfig`, file stores
- [@grest-ts/config-aws](/packages/config-aws) — `GGConfigStoreAwsSecretsManager`
