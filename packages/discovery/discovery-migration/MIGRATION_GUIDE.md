# Zero-Downtime Service Discovery Migration Guide

This guide shows how to migrate from one service discovery strategy to another with **zero downtime** and **safe rollback**.

## Migration Scenarios

Common migrations:
1. **Static URLs → Consul** (Moving from Elastic Beanstalk to Docker Compose)
2. **Consul → Kubernetes** (Moving from Docker to K8s)
3. **Static URLs → Kubernetes** (Moving from simple deployment to K8s)

## The Migration Pattern (3 Phases)

### Phase 1: Dual Registration → Discover from OLD

**Goal**: Start populating the new discovery system while still using the old one

**Code Change**:
```typescript
import { GGServiceDiscovery, GGMigrationServiceDiscovery, GGStaticServiceDiscovery, GGDockerServiceDiscovery } from '@grest-ts/runtime';

const discovery = new GGMigrationServiceDiscovery({
    old: new GGStaticServiceDiscovery(),
    new: new GGDockerServiceDiscovery({ consulUrl: 'http://consul:8500' }),
    discoverFrom: 'old'  // ← Still using old discovery
});

GGServiceDiscovery.set(discovery);
```

**What Happens**:
- ✅ Services register with **both** Static (env vars) and Consul
- ✅ Services discover from **Static URLs** (old)
- ✅ Consul is being populated but not used yet
- ✅ Zero impact on running services
- ✅ Can deploy this change gradually (service by service)

**Verification**:
```bash
# Check Consul is being populated
curl http://consul:8500/v1/catalog/services

# Services still work using old static URLs
curl https://user-service.elasticbeanstalk.com/api/users/123
```

### Phase 2: Dual Registration → Discover from NEW

**Goal**: Switch to using the new discovery system while keeping the old one as fallback

**Code Change**:
```typescript
const discovery = new GGMigrationServiceDiscovery({
    old: new GGStaticServiceDiscovery(),
    new: new GGDockerServiceDiscovery({ consulUrl: 'http://consul:8500' }),
    discoverFrom: 'new'  // ← SWITCHED to new discovery!
});

GGServiceDiscovery.set(discovery);
```

**What Happens**:
- ✅ Services still register with **both** systems
- ✅ Services now discover from **Consul** (new)
- ✅ Old static URLs still work (fallback)
- ✅ Can **rollback** by changing `discoverFrom: 'old'`
- ✅ Deploy this change gradually

**Verification**:
```bash
# Check services are discovering from Consul
curl http://consul:8500/v1/health/service/UserApi

# Old static URLs still work as backup
```

**If Issues Occur**:
```typescript
// INSTANT ROLLBACK - just change this flag!
discoverFrom: 'old'  // ← Back to static URLs
```

### Phase 3: Complete Migration → Use Only NEW

**Goal**: Remove the old discovery system entirely

**Code Change**:
```typescript
// Remove migration wrapper, use new discovery directly
const discovery = new GGDockerServiceDiscovery({
    consulUrl: 'http://consul:8500'
});

GGServiceDiscovery.set(discovery);
```

**What Happens**:
- ✅ Services only register with **Consul**
- ✅ Old static URLs are no longer needed
- ✅ Can remove environment variables
- ✅ Migration complete!

## Complete Example: Static URLs → Consul

### Initial State (Using Static URLs)

**user-service/src/index.ts**:
```typescript
import { GGServiceDiscovery, GGStaticServiceDiscovery } from '@grest-ts/runtime';

// Current state: Static URLs
GGServiceDiscovery.set(new GGStaticServiceDiscovery());
```

**Environment Variables**:
```bash
ORDER_API_URL=https://order-service.elasticbeanstalk.com/api/orders/
PAYMENT_API_URL=https://payment-service.elasticbeanstalk.com/api/payments/
```

### Week 1: Phase 1 - Dual Registration

**Deploy Consul**:
```bash
# Add Consul to docker-compose.yml
docker-compose up consul
```

**Code Change** (deploy to ALL services):
```typescript
import {
    GGServiceDiscovery,
    GGMigrationServiceDiscovery,
    GGStaticServiceDiscovery,
    GGDockerServiceDiscovery
} from '@grest-ts/runtime';

const discovery = new GGMigrationServiceDiscovery({
    old: new GGStaticServiceDiscovery(),
    new: new GGDockerServiceDiscovery({
        serviceName: process.env.SERVICE_NAME,
        consulUrl: process.env.CONSUL_URL || 'http://consul:8500'
    }),
    discoverFrom: 'old'  // Still using static URLs
});

GGServiceDiscovery.set(discovery);
```

**Deployment Order**:
1. Deploy user-service with migration code
2. Deploy order-service with migration code
3. Deploy payment-service with migration code

**Verification**:
```bash
# All services should be in Consul now
curl http://consul:8500/v1/catalog/services
# Output: ["UserApi", "OrderApi", "PaymentApi"]

# Services still work via static URLs
curl https://user-service.elasticbeanstalk.com/health
```

### Week 2: Phase 2 - Switch Discovery

**Code Change** (deploy to ALL services):
```typescript
const discovery = new GGMigrationServiceDiscovery({
    old: new GGStaticServiceDiscovery(),
    new: new GGDockerServiceDiscovery({
        serviceName: process.env.SERVICE_NAME,
        consulUrl: process.env.CONSUL_URL
    }),
    discoverFrom: 'new'  // ← SWITCHED! Now using Consul
});

GGServiceDiscovery.set(discovery);
```

**Deployment Strategy**:
```
1. Deploy to staging → test thoroughly
2. Deploy to canary (10% of production traffic)
3. Monitor metrics, logs, errors
4. If issues: ROLLBACK by changing discoverFrom: 'old'
5. If good: Deploy to 50% of production
6. If good: Deploy to 100% of production
```

**Monitoring**:
```bash
# Watch Consul queries
consul monitor

# Check service discovery logs
docker logs user-service | grep "Discovered.*from 'new'"

# Monitor error rates
# - If errors spike, rollback immediately!
```

### Week 3: Phase 3 - Complete Migration

**Code Change** (deploy to ALL services):
```typescript
import { GGServiceDiscovery, GGDockerServiceDiscovery } from '@grest-ts/runtime';

// Clean code - migration complete!
const discovery = new GGDockerServiceDiscovery({
    serviceName: process.env.SERVICE_NAME,
    consulUrl: process.env.CONSUL_URL
});

GGServiceDiscovery.set(discovery);
```

**Cleanup**:
```bash
# Remove old environment variables
unset ORDER_API_URL
unset PAYMENT_API_URL

# Remove static discovery dependency
npm uninstall @grest-ts/static-discovery  # (if it was separate)
```

## Rollback Strategies

### Instant Rollback (Phase 2)

If you discover issues in Phase 2:

```typescript
// Change this ONE flag
discoverFrom: 'old'  // ← Back to static URLs instantly!
```

Re-deploy and traffic immediately goes back to old discovery.

### Full Rollback (Phase 3)

If you need to rollback after Phase 3:

1. Re-add static environment variables
2. Re-deploy Phase 2 code with `discoverFrom: 'old'`
3. Investigate issues
4. Try migration again

## Advanced: Client Migration

If your discovery method changes the URLs (e.g., different domain names):

### Step 1: Update Clients FIRST

**Before migration**, update client apps with BOTH URLs:

```typescript
// Mobile/Web client
const userApiUrl = process.env.NEW_USER_API_URL || process.env.USER_API_URL;
```

This allows clients to work with both old and new URLs.

### Step 2: Migrate Backend

Follow the 3-phase migration above.

### Step 3: Gradually Roll Out Client Updates

Release new client version that uses `NEW_USER_API_URL`.

### Step 4: Deprecate Old URLs

Once all clients are updated, remove old URL support.

## Migration Checklist

### Before Starting

- [ ] New discovery infrastructure is deployed (Consul, K8s, etc.)
- [ ] All services can reach new discovery (network access)
- [ ] Monitoring is in place (logs, metrics, alerts)
- [ ] Rollback plan is documented
- [ ] Team is aware and on-call

### Phase 1: Dual Registration

- [ ] Code deployed to all services
- [ ] All services registering with new discovery
- [ ] New discovery shows all services
- [ ] Old discovery still working
- [ ] No errors in logs
- [ ] Monitor for 1 week

### Phase 2: Switch Discovery

- [ ] Deploy to staging environment
- [ ] Run full integration tests
- [ ] Deploy to canary (10%)
- [ ] Monitor error rates, latency
- [ ] Deploy to 50%
- [ ] Deploy to 100%
- [ ] Monitor for 1 week
- [ ] Rollback plan tested

### Phase 3: Complete Migration

- [ ] All services using new discovery
- [ ] Old discovery can be safely disabled
- [ ] Remove old configuration
- [ ] Update documentation
- [ ] Migration complete! 🎉

## Best Practices

### 1. Gradual Rollout

Don't deploy to all services at once:
```
Day 1:  Deploy to staging
Day 2:  Deploy to user-service (10% canary)
Day 3:  Deploy to user-service (100%)
Day 4:  Deploy to order-service
Day 5:  Deploy to payment-service
...
```

### 2. Monitor Everything

```typescript
// Add extra logging during migration
const discovery = new GGMigrationServiceDiscovery({
    old: oldDiscovery,
    new: newDiscovery,
    discoverFrom: 'new'
});

// Log every discovery call
const originalDiscover = discovery.discoverApi.bind(discovery);
discovery.discoverApi = async (apiName) => {
    const start = Date.now();
    const result = await originalDiscover(apiName);
    const duration = Date.now() - start;

    console.log(`[MIGRATION] Discovered ${apiName} in ${duration}ms from NEW discovery`);

    return result;
};
```

### 3. Test Fallback

Intentionally break new discovery in staging to verify fallback works:

```typescript
// Temporarily break Consul
docker-compose stop consul

// Services should fall back to static URLs automatically
// Check logs: "Fallback successful! Discovered UserApi from 'old' discovery"
```

### 4. Feature Flags

Use feature flags for extra safety:

```typescript
const useNewDiscovery = await featureFlags.isEnabled('new-service-discovery');

const discovery = new GGMigrationServiceDiscovery({
    old: oldDiscovery,
    new: newDiscovery,
    discoverFrom: useNewDiscovery ? 'new' : 'old'
});
```

Can toggle discovery strategy remotely without deployment!

## Common Issues

### Issue: "API not found in new discovery"

**Cause**: Service hasn't registered with new discovery yet

**Solution**:
1. Verify service is running
2. Check service registered with new discovery
3. Use fallback temporarily: `discoverFrom: 'old'`

### Issue: "Network timeout querying new discovery"

**Cause**: Firewall/network preventing access to Consul/K8s

**Solution**:
1. Check network policies
2. Verify service can reach Consul: `curl http://consul:8500/v1/status/leader`
3. Temporarily rollback: `discoverFrom: 'old'`

### Issue: "Different URLs between old and new"

**Cause**: URL format mismatch

**Example**:
- Old: `https://user-service.elasticbeanstalk.com/api/users/`
- New: `http://user-service:8080/api/users/`

**Solution**: This is expected! The migration wrapper handles this automatically.

## Summary

The 3-phase migration pattern provides:

✅ **Zero downtime** - services never go down
✅ **Safe rollback** - can revert at any phase
✅ **Gradual rollout** - deploy service by service
✅ **Fallback** - automatic failover if new discovery fails
✅ **Simple** - just change one flag to switch
✅ **Battle-tested** - standard dual-write pattern

Your insight was spot-on - this migration strategy makes service discovery changes trivial!
