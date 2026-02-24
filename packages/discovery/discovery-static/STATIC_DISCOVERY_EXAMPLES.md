# Static Service Discovery for Simple Cloud Deployments

This guide shows how to use `GGStaticServiceDiscovery` for deployments where you have static/known URLs and no dynamic service discovery infrastructure.

## When to Use Static Discovery

Use `GGStaticServiceDiscovery` when deploying to:
- **AWS Elastic Beanstalk**
- **Heroku**
- **Railway**
- **Fly.io**
- **DigitalOcean App Platform**
- **Render**
- **Any simple cloud platform** with static URLs

## Scenario 1: AWS Elastic Beanstalk

### Setup

You have two services:
- **user-service**: `https://user-service.us-east-1.elasticbeanstalk.com`
- **order-service**: `https://order-service.us-east-1.elasticbeanstalk.com`

### Option A: Environment Variables (Recommended)

**Set environment variables in Elastic Beanstalk console:**

```bash
USER_API_URL=https://user-service.us-east-1.elasticbeanstalk.com/api/users/
ORDER_API_URL=https://order-service.us-east-1.elasticbeanstalk.com/api/orders/
```

**In your application code:**

```typescript
import { GGServiceDiscovery, GGStaticServiceDiscovery } from '@grest-ts/runtime';

// Auto-discovers from environment variables
GGServiceDiscovery.set(new GGStaticServiceDiscovery());

// That's it! The discovery reads USER_API_URL, ORDER_API_URL, etc.
```

### Option B: Explicit Configuration

```typescript
import { GGServiceDiscovery, GGStaticServiceDiscovery } from '@grest-ts/runtime';

const discovery = new GGStaticServiceDiscovery({
    UserApi: 'https://user-service.us-east-1.elasticbeanstalk.com/api/users/',
    OrderApi: 'https://order-service.us-east-1.elasticbeanstalk.com/api/orders/'
});

GGServiceDiscovery.set(discovery);
```

### Using the APIs

```typescript
// In order-service, calling user-service
import { UserApiClient } from './api/UserApiClient.gen';

// Client uses service discovery automatically (knows its API name from generation)
const userClient = new UserApiClient();

const user = await userClient.getUser('123');
```

## Scenario 2: Single Service (No Service-to-Service Communication)

If you have just ONE service and no service-to-service calls:

```typescript
import { GGRuntime } from '@grest-ts/runtime';

// Don't even set service discovery - not needed!
const runtime = new GGRuntime('my-service');
await runtime.start();

// Your service runs, handles HTTP requests, but doesn't call other services
```

## Scenario 3: Heroku with Multiple Apps

### Heroku Config

```bash
# In order-service Heroku app
heroku config:set USER_API_URL=https://user-service-prod.herokuapp.com/api/users/
heroku config:set PAYMENT_API_URL=https://payment-service.herokuapp.com/api/payments/
```

### Application Code

```typescript
// Same code works across all environments!
import { GGServiceDiscovery, GGStaticServiceDiscovery } from '@grest-ts/runtime';

GGServiceDiscovery.set(new GGStaticServiceDiscovery());
```

## Scenario 4: Railway with Internal URLs

Railway provides both public and internal URLs. Use internal for service-to-service:

```bash
# Use Railway's internal networking (faster, free bandwidth)
USER_API_URL=http://user-service.railway.internal/api/users/
ORDER_API_URL=http://order-service.railway.internal/api/orders/
```

## Scenario 5: Mixed Environment (Dev + Cheap Prod)

You can use different discovery strategies per environment:

```typescript
import {
    GGServiceDiscovery,
    GGStaticServiceDiscovery,
    GGDockerServiceDiscovery,
    GGKubernetesServiceDiscovery
} from '@grest-ts/runtime';

function setupDiscovery() {
    if (process.env.JEST_WORKER_ID) {
        // Tests use test discovery
        const { GGTestServiceDiscovery } = require('@grest-ts/testkit');
        return new GGTestServiceDiscovery();
    }

    if (process.env.NODE_ENV === 'production' && process.env.K8S_SERVICE_NAME) {
        // Production on Kubernetes
        return new GGKubernetesServiceDiscovery();
    }

    if (process.env.NODE_ENV === 'staging' && process.env.CONSUL_URL) {
        // Staging on Docker Compose with Consul
        return new GGDockerServiceDiscovery();
    }

    // Dev or cheap prod: use static URLs
    return new GGStaticServiceDiscovery();
}

GGServiceDiscovery.set(setupDiscovery());
```

## Environment Variable Naming Convention

The static discovery automatically converts environment variables:

| Environment Variable | API Name |
|---------------------|----------|
| `USER_API_URL` | `UserApi` |
| `ORDER_API_URL` | `OrderApi` |
| `PAYMENT_SERVICE_API_URL` | `PaymentServiceApi` |
| `AUTH_API_URL` | `AuthApi` |

**Pattern**: `{API_NAME}_API_URL` → `{ApiName}Api`

## Complete Example: Order Service Calling User Service

### order-service/.env (Elastic Beanstalk)

```bash
# External services this service depends on
USER_API_URL=https://user-service.us-east-1.elasticbeanstalk.com/api/users/
PAYMENT_API_URL=https://payment.myapp.com/api/payments/

# This service's own config
PORT=8080
DATABASE_URL=postgres://...
```

### order-service/src/index.ts

```typescript
import { GGRuntime, GGServiceDiscovery, GGStaticServiceDiscovery } from '@grest-ts/runtime';
import { GGHttp } from '@grest-ts/http-server';
import { OrderApiServer } from './api/OrderApiServer.gen';
import { UserApiClient } from './api/UserApiClient.gen';
import { PaymentApiClient } from './api/PaymentApiClient.gen';

// Setup static discovery (reads USER_API_URL, PAYMENT_API_URL from env)
GGServiceDiscovery.set(new GGStaticServiceDiscovery());

// Create runtime
const runtime = new GGRuntime('order-service');

// Create HTTP server
const http = new GGHttp({ port: process.env.PORT || 8080 });

// Register API handlers
OrderApiServer.start(http, {
    async createOrder(data) {
        // Call user service
        const userClient = new UserApiClient();
        const user = await userClient.getUser(data.userId);

        // Call payment service
        const paymentClient = new PaymentApiClient();
        const payment = await paymentClient.processPayment({
            amount: data.total,
            userId: user.userId
        });

        // Create order
        return {
            orderId: generateId(),
            userId: user.userId,
            paymentId: payment.id,
            status: 'confirmed'
        };
    }
});

// Start
await runtime.start();
console.log('Order service running on port', process.env.PORT);
```

## Comparison: Static vs Dynamic Discovery

| Feature | Static Discovery | Consul (Docker) | K8s ConfigMap |
|---------|-----------------|-----------------|---------------|
| **Setup** | Environment variables | Consul server | K8s cluster |
| **Cost** | Free | Infrastructure cost | K8s cost |
| **Complexity** | Very simple | Medium | High |
| **Scaling** | Manual updates | Automatic | Automatic |
| **Load Balancing** | External (cloud LB) | Consul | K8s Service |
| **Health Checks** | Cloud platform | Consul | K8s |
| **Best For** | Small apps, <10 services | Docker Compose staging | Production at scale |

## When to Upgrade from Static

Consider upgrading from static discovery when:
- You have **>10 services** (too many env vars to manage)
- Services **scale horizontally** (multiple instances)
- You need **automatic failover**
- You want **zero-downtime deployments**
- Services are **frequently added/removed**

Then migrate to:
- **Docker Compose + Consul** for staging
- **Kubernetes** for production

But for **many startups**, static discovery with Elastic Beanstalk/Heroku is perfectly fine and much simpler!

## Tips for Static Discovery

1. **Use full URLs** including pathPrefix:
   ```bash
   # Good
   USER_API_URL=https://user-service.com/api/users/

   # Bad (missing path)
   USER_API_URL=https://user-service.com
   ```

2. **Centralize configuration** in a deployment tool (Terraform, CloudFormation)

3. **Use internal URLs** when possible (faster, cheaper):
   ```bash
   # Railway internal
   USER_API_URL=http://user-service.railway.internal/api/users/

   # Heroku private spaces
   USER_API_URL=http://user-service.internal/api/users/
   ```

4. **Version your environment variables**:
   ```bash
   USER_API_V1_URL=https://user-service.com/api/v1/users/
   USER_API_V2_URL=https://user-service.com/api/v2/users/
   ```

5. **Validate on startup**:
   ```typescript
   const discovery = new GGStaticServiceDiscovery();

   // Ensure all required APIs are configured
   const required = ['UserApi', 'OrderApi', 'PaymentApi'];
   for (const api of required) {
       try {
           await discovery.discoverApi(api);
       } catch (err) {
           console.error(`Missing configuration for ${api}`);
           process.exit(1);
       }
   }
   ```

## Conclusion

Static service discovery is:
- ✅ **Simple** - just environment variables
- ✅ **Cheap** - no infrastructure cost
- ✅ **Reliable** - no discovery service to fail
- ✅ **Portable** - works on any cloud platform
- ✅ **Perfect for startups** and small applications

Start with static discovery, then upgrade to dynamic discovery when you need it!
