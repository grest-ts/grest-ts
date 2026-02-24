# Job Processing Patterns

This document maps out the common job processing architectures, when to use each, and how they relate to the `@grest-ts/job` package.

## Table of Contents

1. [Distribution Patterns](#pattern-matrix) - How jobs are distributed and processed
2. [Trigger Types](#trigger-types) - Event-driven vs scheduled
3. [Cross-Cutting Concerns](#cross-cutting-concerns) - DLQ, idempotency, retries
4. [Priority Strategies](#priority-queues-vs-multiple-queues) - Handling job priority
5. [Workflow Orchestration](#workflow-orchestration-temporal-cadence) - Multi-step durable workflows
6. [Decision Matrix](#decision-matrix) - When to use what

## Pattern Matrix

| Pattern | Concurrency | Distribution | Implementation | Use Case |
|---------|-------------|--------------|----------------|----------|
| **1. Sequential, Single Instance** | 1 job at a time | Single process | `@grest-ts/job` with `concurrency: 1` | Order-sensitive, resource-constrained |
| **2. Parallel, Single Instance** | N jobs at a time | Single process | `@grest-ts/job` with `concurrency: N` | CPU-bound, moderate throughput |
| **3. Sequential, Multi Instance** | 1 job per instance | Multiple processes | Message queue + workers | Strict ordering per partition |
| **4. Parallel, Multi Instance** | N jobs per instance | Multiple processes | Message queue + worker pool | High throughput, horizontal scale |
| **5. CDC (Change Data Capture)** | N jobs per instance | Multiple processes | DB log tailing + Kafka | Maximum throughput, real-time |

## Pattern Details

### 1. Sequential, Single Instance

```
┌─────────────────────────────────────────────────┐
│                 Single Process                   │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐     │
│  │  Job 1  │ -> │  Job 2  │ -> │  Job 3  │ ... │
│  └─────────┘    └─────────┘    └─────────┘     │
└─────────────────────────────────────────────────┘
```

**How it works:**
- Single master process (leader election via lock)
- Jobs processed one at a time, in order
- Next job starts only after previous completes

**Good for:**
- **Database migrations** - must run in order, can't parallelize
- **Sequential workflows** - step 2 depends on step 1
- **Rate-limited APIs** - external service allows 1 req/sec
- **Resource-constrained** - job needs exclusive access to a resource
- **Simple debugging** - deterministic execution order

**Industry examples:**
- Rails ActiveJob with `config.active_job.queue_adapter = :inline`
- Celery with `--concurrency=1`
- Sidekiq with `concurrency: 1`

**@grest-ts/job config:**
```typescript
{
  concurrency: 1,
  batchSize: 1
}
```

---

### 2. Parallel, Single Instance

```
┌─────────────────────────────────────────────────┐
│                 Single Process                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│  │  Job 1  │  │  Job 2  │  │  Job 3  │         │
│  └─────────┘  └─────────┘  └─────────┘         │
│       │            │            │               │
│       ▼            ▼            ▼               │
│  [Processing in parallel within event loop]     │
└─────────────────────────────────────────────────┘
```

**How it works:**
- Single master process (leader election via lock)
- Multiple jobs processed concurrently (async/await, not threads)
- Bounded by `concurrency` setting

**Good for:**
- **I/O-bound tasks** - HTTP calls, DB queries, file operations
- **Email sending** - send 10 emails concurrently
- **Webhook delivery** - parallel HTTP POSTs
- **Image processing** - if using async libraries
- **Moderate scale** - hundreds to low thousands of jobs/hour

**Trade-offs:**
- Simple deployment (single process)
- Limited by single machine resources
- No horizontal scaling
- Good enough for 80% of use cases

**Industry examples:**
- Node.js with `p-limit` or `async.parallelLimit`
- Sidekiq (Ruby) - default concurrent workers
- Bull (Node.js) - default behavior

**@grest-ts/job config:**
```typescript
{
  concurrency: 10,  // Process 10 jobs at once
  batchSize: 20     // Fetch 20 at a time
}
```

---

### 3. Sequential, Multi Instance (Partitioned Queues)

```
                    ┌──────────────┐
                    │ Message Queue │
                    │  (SQS/Kafka)  │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │ Partition 0 │  │ Partition 1 │  │ Partition 2 │
   │  Worker A   │  │  Worker B   │  │  Worker C   │
   │  (seq: 1)   │  │  (seq: 1)   │  │  (seq: 1)   │
   └─────────────┘  └─────────────┘  └─────────────┘
        │                 │                │
        ▼                 ▼                ▼
   [Job 1, 4, 7]    [Job 2, 5, 8]    [Job 3, 6, 9]
   (in order)       (in order)       (in order)
```

**How it works:**
- Jobs partitioned by key (user_id, account_id, etc.)
- Each partition processed by one worker, sequentially
- Ordering guaranteed within partition, parallel across partitions

**Good for:**
- **Per-user operations** - user's jobs must be in order
- **Account processing** - each account's transactions sequential
- **Event sourcing** - events for an aggregate in order
- **FIFO requirements** - but need horizontal scale

**Key insight:** You often don't need global ordering, just ordering per entity.

**Industry examples:**
- Kafka with partition keys
- SQS FIFO queues with message group IDs
- Amazon Kinesis with partition keys
- Azure Service Bus sessions

**Implementation pattern:**
```
1. Produce: queue.send(job, partitionKey: job.userId)
2. Consume: each worker claims one or more partitions
3. Process: sequential within partition
```

---

### 4. Parallel, Multi Instance (Fan-out)

```
                    ┌──────────────┐
                    │ Message Queue │
                    │  (SQS/SNS)   │
                    └──────┬───────┘
                           │
     ┌─────────────────────┼─────────────────────┐
     ▼                     ▼                     ▼
┌──────────┐         ┌──────────┐         ┌──────────┐
│ Worker 1 │         │ Worker 2 │         │ Worker 3 │
│ (N jobs) │         │ (N jobs) │         │ (N jobs) │
└──────────┘         └──────────┘         └──────────┘
     │                     │                     │
     ▼                     ▼                     ▼
[Job A,B,C]          [Job D,E,F]          [Job G,H,I]
(parallel)           (parallel)           (parallel)
```

**How it works:**
- Message queue handles distribution
- Multiple worker instances pull jobs
- Each worker processes multiple jobs concurrently
- Auto-scaling based on queue depth

**Good for:**
- **High throughput** - 10K+ jobs/hour
- **Elastic scaling** - scale workers up/down with load
- **Burst handling** - queue absorbs spikes
- **Decoupling** - producers and consumers independent
- **Cross-service** - jobs can be processed by different services

**Trade-offs:**
- More infrastructure (queue service)
- No ordering guarantees (or use FIFO variant)
- At-least-once delivery (need idempotency)
- More complex deployment

**Industry examples:**
- AWS: SQS + Lambda / ECS
- GCP: Pub/Sub + Cloud Run
- Azure: Service Bus + Functions
- Self-hosted: RabbitMQ + worker pods

---

### 5. CDC - Change Data Capture (End Game)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Database   │     │   Debezium  │     │    Kafka    │     │   Workers   │
│   (MySQL)   │ --> │  Connector  │ --> │   Topics    │ --> │   (N pods)  │
│             │     │             │     │             │     │             │
│  binlog/WAL │     │  Log Tailing│     │  Partitions │     │  Parallel   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │                   │
       ▼                   ▼                   ▼                   ▼
   [INSERT]           [Capture]          [Stream]           [Process]
   [UPDATE]           [Transform]        [Partition]        [At Scale]
   [DELETE]           [Publish]          [Retain]           [Replay]
```

**How it works:**
- Database writes to its transaction log (binlog for MySQL, WAL for Postgres)
- CDC connector (Debezium) tails the log in real-time
- Changes published to Kafka topics (one topic per table or aggregate)
- Consumers process changes with full Kafka semantics (partitioning, replay, etc.)
- No polling - changes stream in milliseconds

**The key difference from Pattern 4:**
```
Pattern 4 (Outbox + Polling):
  App writes job -> Poll every 1s -> Process
  Latency: 0-1000ms (poll interval)

Pattern 5 (CDC):
  App writes row -> Binlog captured -> Kafka -> Process
  Latency: 10-100ms (near real-time)
```

**Good for:**
- **Extreme throughput** - 1M+ events/day
- **Real-time requirements** - sub-second latency
- **Event sourcing** - full history replay from Kafka
- **Multi-consumer** - many services react to same changes
- **Microservices** - data sync between services
- **Analytics pipelines** - stream to data warehouse
- **Audit logging** - immutable change history

**The complexity tax:**

| Component | What You Need | Operational Burden |
|-----------|---------------|-------------------|
| **Kafka** | Cluster (3+ brokers minimum) | Partition management, rebalancing, monitoring |
| **Zookeeper/KRaft** | Coordination layer | HA setup, upgrades |
| **Debezium** | Connector per database | Schema registry, offset management |
| **Schema Registry** | Avro/Protobuf schemas | Schema evolution, compatibility |
| **Connect Cluster** | Kafka Connect workers | Scaling, task distribution |
| **Monitoring** | Lag monitoring, alerting | Consumer lag, connector health |

**Industry examples:**
- Debezium + Kafka (most common)
- AWS DMS + Kinesis
- GCP Datastream + Pub/Sub
- Maxwell (MySQL only)
- Striim, Confluent Platform (commercial)

**When NOT to use CDC:**
- Team < 10 engineers (operational overhead too high)
- < 100K events/day (overkill)
- Simple CRUD apps (Pattern 2 is fine)
- No Kafka expertise in-house
- Budget constraints (Kafka clusters aren't cheap)

**Realistic team size:**
```
Pattern 1-2: 1-5 engineers (solo dev can run this)
Pattern 3-4: 5-20 engineers (DevOps handles queues)
Pattern 5:   20+ engineers (dedicated data/platform team)
```

**Migration path:**

```
Year 1: @grest-ts/job (Pattern 2)
        └── Simple, gets you to product-market fit

Year 2: SQS/Pub-Sub (Pattern 4)
        └── Scale is hitting limits, add managed queue

Year 3+: CDC (Pattern 5)
         └── Multiple teams, real-time requirements, data platform
```

---

## Trigger Types

Jobs can be triggered in two fundamentally different ways:

| Trigger | Description | Example | Implementation |
|---------|-------------|---------|----------------|
| **Event-Driven** | Triggered by an action | User signup -> send welcome email | Queue message on event |
| **Schedule-Driven** | Triggered by time | Every hour, sync inventory | Cron job or scheduler |

### Event-Driven (Reactive)

```
User Action -> Write to DB + Queue Job -> Worker Processes
```

**Examples:**
- User signs up -> send verification email
- Order placed -> process payment
- File uploaded -> generate thumbnails

**Implementation:** Queue job in same transaction as business logic (outbox pattern).

### Schedule-Driven (Proactive)

```
Cron/Scheduler -> Query for Work -> Process Batch
```

**Examples:**
- Every 5 minutes: check for abandoned carts
- Daily at 2am: generate reports
- Hourly: sync external data

**The Parameterless Job Pattern:**

Instead of queuing jobs with parameters that could fail:
```typescript
// RISKY: If queue fails, job is lost
await db.update(order, { status: 'pending_sync' });
await queue.add({ orderId: order.id }); // What if this fails?
```

Use a scheduled collector that examines state:
```typescript
// SAFE: Scheduled job finds work by querying state
const pendingOrders = await db.query(
  'SELECT * FROM orders WHERE status = ? AND updated_at < ?',
  ['pending_sync', fiveMinutesAgo]
);
for (const order of pendingOrders) {
  await syncOrder(order);
}
```

This is exactly what `@grest-ts/job` does with `getData()` - a scheduled collector pattern.

---

## Cross-Cutting Concerns

These concerns apply to **all** distribution patterns (1-5):

### Dead Letter Queue (DLQ)

```
Main Queue -> Process -> [Success] -> Done
                     \-> [Fail x3] -> DLQ -> Alert/Manual Review
```

**What it is:** A holding queue for messages that repeatedly fail processing.

**Why you need it:**
- Prevents poison messages from blocking the queue
- Preserves failed messages for debugging
- Enables manual retry after fixing issues

**Best practices:**
- Set `maxRetries` (typically 3-5)
- Alert on DLQ growth
- Build tooling to inspect and replay DLQ messages
- Log failure reasons before moving to DLQ

### Retry Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| **Immediate** | Retry right away | Transient network blip |
| **Fixed Delay** | Wait N seconds between retries | Rate-limited API |
| **Exponential Backoff** | 1s, 2s, 4s, 8s... | Overloaded downstream |
| **Exponential + Jitter** | Backoff with random offset | Prevent thundering herd |

```typescript
// Exponential backoff with jitter
const delay = Math.min(
  baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
  maxDelay
);
```

**Only retry on:**
- Network timeouts
- 5xx errors (server errors)
- Rate limits (429)
- Temporary resource unavailable

**Don't retry on:**
- 4xx errors (client errors)
- Validation failures
- Business logic errors

### Idempotency

**The reality:** At-least-once delivery is what you get. Exactly-once is a myth (or very expensive).

```
Job may run: 0 times (lost) - unacceptable
             1 time (ideal) - what we want
             N times (retry) - must handle this!
```

**Idempotency strategies:**

| Strategy | How | Example |
|----------|-----|---------|
| **Idempotency Key** | Check if already processed | `IF NOT EXISTS (SELECT 1 FROM processed WHERE key = ?)` |
| **Natural Idempotency** | Operation is inherently safe | `SET status = 'done'` (same result if run twice) |
| **Version/ETag** | Reject stale updates | `UPDATE ... WHERE version = ?` |
| **Deduplication Window** | Ignore duplicates within time window | Redis `SETNX` with TTL |

```typescript
// Idempotency key pattern
async function processJob(job: Job) {
  const key = `job:${job.id}`;

  // Check if already processed
  const exists = await redis.get(key);
  if (exists) {
    return; // Already done, skip
  }

  // Do the work
  await doActualWork(job);

  // Mark as processed (with TTL for cleanup)
  await redis.set(key, '1', 'EX', 86400 * 7); // 7 days
}
```

### Rate Limiting

Protect downstream services from being overwhelmed:

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Queue     │ --> │ Rate Limiter │ --> │  External   │
│ (100 jobs)  │     │ (10 req/sec) │     │    API      │
└─────────────┘     └──────────────┘     └─────────────┘
```

**Approaches:**
- **Concurrency limit:** Process max N jobs at once
- **Token bucket:** N requests per time window
- **Leaky bucket:** Smooth out bursts

In `@grest-ts/job`, use `concurrency` setting for simple rate limiting.

---

## Priority Queues vs Multiple Queues

When you need to prioritize some jobs over others:

### Option 1: Priority Queue (Single Queue)

```
High Priority ─┐
               ├──> [Single Queue sorted by priority] ──> Workers
Low Priority  ─┘
```

**Problem: Starvation.** High-priority jobs keep coming, low-priority jobs never run.

### Option 2: Multiple Queues (Recommended)

```
Critical Queue ───> [Worker Pool 1] (dedicated)

High Queue     ───> [Worker Pool 2] (shared, checks Critical first)

Normal Queue   ───> [Worker Pool 2] (shared)
```

**Strategies:**
- **Dedicated workers:** Critical queue has its own workers
- **Weighted round-robin:** Process 3 high for every 1 normal
- **Queue draining:** Workers check higher queues when idle

```typescript
// Weighted round-robin example
const queues = [
  { name: 'critical', weight: 10 },
  { name: 'high', weight: 5 },
  { name: 'normal', weight: 1 }
];

// Process proportionally more from higher-weight queues
```

**When to use multiple queues:**
- Different SLAs (critical must complete in 1 min, normal in 1 hour)
- Different resource requirements (CPU-heavy vs I/O-heavy)
- Different retry strategies

---

## Workflow Orchestration (Temporal / Cadence)

Sometimes jobs aren't simple tasks - they're **multi-step workflows** with complex error handling.

### Simple Jobs vs Workflows

| Simple Job | Workflow |
|------------|----------|
| Send email | Order fulfillment (reserve inventory -> charge card -> ship -> notify) |
| Resize image | User onboarding (create account -> verify email -> setup profile -> send welcome) |
| Sync record | Payment processing with retry and compensation |

### The Saga Pattern Problem

Multi-step operations need **compensation** when something fails:

```
1. Reserve Inventory  ✓
2. Charge Credit Card ✓
3. Book Shipping      ✗ FAILED!
   └── Need to: Refund Card, Release Inventory
```

**Without orchestration:** You write complex state machines, retry logic, and compensation handlers yourself.

### Temporal / Cadence

```
┌─────────────────────────────────────────────────────────────┐
│                    Temporal Server                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Workflow   │  │  Workflow   │  │  Workflow   │  ...   │
│  │  State 1    │  │  State 2    │  │  State 3    │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
      ┌──────────┐  ┌──────────┐  ┌──────────┐
      │ Worker 1 │  │ Worker 2 │  │ Worker 3 │
      │ (code)   │  │ (code)   │  │ (code)   │
      └──────────┘  └──────────┘  └──────────┘
```

**The magic:** Your workflow is regular code, but Temporal makes it **durable**.

```typescript
// This looks like normal code, but survives crashes!
async function orderWorkflow(orderId: string) {
  // Step 1: Reserve inventory (if we crash here, Temporal resumes)
  await activities.reserveInventory(orderId);

  // Step 2: Charge card
  try {
    await activities.chargeCard(orderId);
  } catch (e) {
    // Compensation: release inventory
    await activities.releaseInventory(orderId);
    throw e;
  }

  // Step 3: Ship
  await activities.shipOrder(orderId);
}
```

**What Temporal gives you:**
- Automatic state persistence (survives crashes)
- Built-in retry with backoff
- Timeouts and deadlines
- Workflow versioning
- Full execution history (debugging)
- Exactly-once semantics (within workflow)

### When to Use Workflow Orchestration

| Use Case | Simple Job Queue | Workflow Orchestration |
|----------|------------------|------------------------|
| Send email | ✓ | |
| Multi-step with compensation | | ✓ |
| Long-running (hours/days) | | ✓ |
| Human-in-the-loop approval | | ✓ |
| Complex branching logic | | ✓ |
| Need full audit trail | | ✓ |

### The Complexity Cost

```
Simple Job Queue (@grest-ts/job, Sidekiq, Bull):
  - Redis or DB
  - Worker process
  - Done

Temporal:
  - Temporal Server (or Temporal Cloud @ $200/mo+)
  - Persistence (Postgres/Cassandra)
  - Workers
  - Mental model shift (workflow thinking)
```

**Recommendation:** Start with simple job queues. Graduate to Temporal when:
- You're building complex state machines by hand
- You need compensation/saga patterns
- Workflows span hours or days
- You need human approval steps
- Debugging job failures is painful

---

## Decision Matrix

| Criteria | Pattern 1 | Pattern 2 | Pattern 3 | Pattern 4 | Pattern 5 (CDC) |
|----------|-----------|-----------|-----------|-----------|-----------------|
| **Throughput** | Low | Medium | Medium-High | Very High | Extreme |
| **Latency** | Poll interval | Poll interval | ~100ms | ~100ms | ~10-50ms |
| **Ordering** | Global | None | Per-partition | None | Per-partition |
| **Complexity** | Lowest | Low | Medium | Higher | Very High |
| **Infrastructure** | DB only | DB only | Queue service | Queue service | Kafka + Debezium + DB |
| **Scaling** | Vertical | Vertical | Horizontal | Horizontal | Horizontal |
| **Failover** | Via lock | Via lock | Via queue | Via queue | Via Kafka |
| **Team Size** | 1-5 | 1-5 | 5-20 | 5-20 | 20+ |
| **Cost** | Lowest | Low | Medium | Higher | Highest |

## When to Use What

### Start with Pattern 1 or 2 (`@grest-ts/job`) when:

- You have < 10K jobs/day
- Jobs are I/O-bound (API calls, DB operations)
- You don't need horizontal scaling yet
- You want minimal infrastructure
- You need transactional consistency (job created in same DB transaction)
- You're a small team and simplicity matters

### Graduate to Pattern 3 or 4 (Message Queues) when:

- Throughput exceeds single-instance capacity
- You need to scale workers independently
- Jobs come from multiple services
- You need retry/DLQ features out of the box
- You're already using AWS/GCP/Azure managed services
- You need to handle traffic bursts gracefully

## The Transactional Outbox Bridge

`@grest-ts/job` solves the **transactional outbox pattern** - the problem of atomically committing a database change AND enqueueing a job:

```typescript
// PROBLEM: Not atomic - if step 2 fails, order exists but no job
await db.insert(orders, order);        // 1. DB commit
await sqs.send({ orderId: order.id }); // 2. Queue message (might fail!)

// SOLUTION: Outbox pattern with @grest-ts/job
await db.transaction(async (tx) => {
  await tx.insert(orders, order);
  await tx.insert(jobs, {              // Job in same transaction
    type: 'process-order',
    data: { orderId: order.id }
  });
});
// GGJobRunner polls and processes
```

You can even use `@grest-ts/job` as a **relay** to Pattern 4:

```typescript
// GGJobRunner picks up from DB, relays to SQS
const operations = {
  getData: (limit) => db.query('SELECT * FROM outbox WHERE sent=0 LIMIT ?', [limit]),
  runTask: async (job) => {
    await sqs.send(job.data);
  },
  onComplete: async (job) => {
    await db.query('UPDATE outbox SET sent=1 WHERE id=?', [job.id]);
  }
};
```

## Summary

| Scale | Team | Recommendation |
|-------|------|----------------|
| **< 1K jobs/day** | 1-5 | Pattern 1 or 2 with `@grest-ts/job` |
| **1K - 100K jobs/day** | 5-10 | Pattern 2 with `@grest-ts/job`, consider Pattern 4 |
| **100K - 1M jobs/day** | 10-20 | Pattern 4 with managed queue (SQS/Pub-Sub) |
| **> 1M jobs/day** | 20+ | Pattern 5 with CDC (Debezium + Kafka) |
| **Per-entity ordering at scale** | 10+ | Pattern 3 or 5 with Kafka partitions |
| **Real-time (<100ms)** | 20+ | Pattern 5 with CDC |

The beauty of `@grest-ts/job` is that it covers Pattern 1 and 2 with minimal infrastructure, and the transactional outbox pattern means you can always **relay** to Pattern 3/4/5 later without changing your application code - just change what `runTask` does.

## The Honest Truth About CDC

CDC is the "end game" solution - highest performance, lowest latency, best scalability. But it comes with a **dedicated team requirement**:

```
CDC is not a library you install.
CDC is a platform you operate.
```

**What "operating CDC" means:**
- Kafka cluster upgrades and rebalancing
- Debezium connector failures and restarts
- Schema evolution and compatibility
- Consumer lag monitoring and alerting
- Partition rebalancing during deploys
- Offset management and replay scenarios
- Cross-datacenter replication (if needed)

**The 10-engineer rule:** If you don't have at least 10 engineers, and at least 2 who understand Kafka deeply, you will struggle. The operational burden will slow you down more than the performance gains help you.

**Start simple, evolve when needed:**
```
@grest-ts/job -> SQS/Pub-Sub -> CDC
   │            │           │
   └── 80%      └── 15%     └── 5% of companies need this
       of use       of use
       cases        cases
```

---

## Industry Libraries & Frameworks

| Language | Simple Job Queue | Workflow Orchestration |
|----------|------------------|------------------------|
| **Node.js** | Bull, BullMQ, Agenda, `@grest-ts/job` | Temporal (TypeScript SDK) |
| **Ruby** | Sidekiq, Resque, DelayedJob | Temporal (Ruby SDK) |
| **Python** | Celery, RQ, Dramatiq | Temporal, Prefect, Airflow |
| **Java** | Quartz, Spring Batch | Temporal (Java SDK), Camunda |
| **Go** | Asynq, Machinery | Temporal (Go SDK) |
| **C#** | Hangfire, Quartz.NET | Temporal, Azure Durable Functions |

**Managed Services:**
- AWS: SQS, Step Functions, EventBridge
- GCP: Cloud Tasks, Workflows, Pub/Sub
- Azure: Service Bus, Durable Functions, Logic Apps

---

## References

- [Background Jobs Guidance - Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/best-practices/background-jobs)
- [Scaling Slack's Job Queue](https://slack.engineering/scaling-slacks-job-queue/) - Processing 1.4B jobs/day
- [Multiple Queues vs Prioritized Queues](https://shermanonsoftware.com/2024/07/10/multiple-queues-vs-prioritized-queues-for-saas-background-workers/)
- [Sidekiq vs Temporal - Vantage Migration Story](https://www.vantage.sh/blog/sidekiq-vs-temporal)
- [Dead Letter Queues - AWS](https://aws.amazon.com/what-is/dead-letter-queue/)
- [Kafka Dead Letter Queue Guide - Confluent](https://www.confluent.io/learn/kafka-dead-letter-queue/)
- [Task Queues Comparison](https://taskqueues.com/) - Comprehensive list of job queue libraries
