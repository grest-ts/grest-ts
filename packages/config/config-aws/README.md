<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/config-aws

AWS Secrets Manager store for `@grest-ts/config`.

Fetches a single JSON secret from AWS Secrets Manager at startup and serves values from cache.
Path resolution is identical to `GGConfigStoreFile` — `key.name.split("/")` walks the JSON tree.

## Usage

```typescript
import {GGConfigLocator, GGSecret, GGResource} from "@grest-ts/config"
import {GGConfigStoreAwsSecretsManager} from "@grest-ts/config-aws"

new GGConfigLocator(AppConfig)
    .add([GGSecret, GGResource], new GGConfigStoreAwsSecretsManager({
        secretName: "my-app/production",
        region: "eu-west-1"
    }))
```

## Options

| Option            | Required | Description                                                  |
|-------------------|----------|--------------------------------------------------------------|
| `secretName`      | yes      | The name or ARN of the secret in AWS Secrets Manager         |
| `region`          | no       | AWS region (falls back to SDK default / environment)         |
| `accessKeyId`     | no       | Explicit credentials (falls back to SDK default chain)       |
| `secretAccessKey` | no       | Explicit credentials (falls back to SDK default chain)       |

## Secret Format

The secret value must be a JSON string. Key paths map to the JSON structure:

```json
{
    "app": {
        "db": {
            "host": "prod-db.example.com",
            "password": "hunter2"
        }
    }
}
```

A key with path `/app/db/host` resolves to `"prod-db.example.com"`.
