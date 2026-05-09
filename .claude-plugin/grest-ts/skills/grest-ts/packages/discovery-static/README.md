<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/discovery-static

Static service discovery for deployments with known, fixed URLs (AWS Elastic Beanstalk, Heroku, Railway, Fly.io, etc.). No dynamic registration or discovery infrastructure needed.

For a full overview of how discovery works, see the [Discovery guide](@guide/discovery).

## Usage

### From environment variables

```bash
USER_API_URL=https://user-service.elasticbeanstalk.com/api/users/
ORDER_API_URL=https://order-service.us-east-1.elasticbeanstalk.com/api/orders/
```

```typescript
const discovery = new GGStaticServiceDiscovery();
// Reads *_API_URL env vars automatically
// USER_API_URL -> UserApi
// ORDER_API_URL -> OrderApi
```

### From a config object

```typescript
const discovery = new GGStaticServiceDiscovery({
    UserApi: 'https://user-service.elasticbeanstalk.com/api/users/',
    OrderApi: 'https://order-service.elasticbeanstalk.com/api/orders/'
});
```

`registerRoutes()` is a no-op since URLs are pre-configured.
