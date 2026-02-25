<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/testkit-runtime

Thin runtime component of `@grest-ts/testkit`. Provides the `@mockable` and `@testable` decorators that you add to your service classes. This package is included in production builds but has **zero effect at runtime** — decorators only activate when a test context is present.

You typically don't interact with this package directly beyond applying the decorators.

## `@mockable`

Marks a class so its async methods can be mocked or spied on during tests.

```typescript
import {mockable} from "@grest-ts/testkit-runtime";

@mockable
export class WeatherService {
    async getWeather(city: string): Promise<WeatherData> {
        // real implementation
    }
}
```

In production, calls pass through unchanged. During tests, `@grest-ts/testkit` can intercept calls via `mockOf()` and `spyOn()`.

## `@testable`

Marks a class so tests can invoke its methods directly via `callOn()`, without going through the full API layer.

```typescript
import {mockable, testable} from "@grest-ts/testkit-runtime";

@testable
@mockable
export class WeatherService {
    async getWeather(city: string): Promise<WeatherData> { /* ... */ }
}
```

Instances are automatically registered in the service locator on construction, making them accessible to the test runner.
