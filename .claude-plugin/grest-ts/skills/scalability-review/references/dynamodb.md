# DynamoDB checks

For redesigning keys, GSIs or access patterns, use AWS's `amazon-dynamodb` skill if it's installed (aws/agent-toolkit-for-aws). This file only covers what to flag when reviewing code. Single-table designs deliberately group bounded item collections under one partition key: a whole-partition query on a collection that's bounded by design is fine.

## Reads
- `Scan` on a table that grows, especially followed by filtering in code. Scanning a small static table once at boot is fine. Legitimate bulk reads (migrations, analytics) should use parallel Scan with segments and rate limiting, or Export to S3, which uses no RCU.
- `Limit` and the 1 MB page cap apply *before* `FilterExpression`. A page can be empty and still have a `LastEvaluatedKey`. `Limit: 1` plus a filter can return nothing, and a loop that stops on an empty page truncates. You pay RCU for every item read, not every item returned, and `Select: COUNT` still reads every item.
- `Query` on a partition that grows with history without `Limit` and `ExclusiveStartKey`. Code that ignores `LastEvaluatedKey` silently truncates; code that loops it loads everything into memory.
- "Latest X" done as query-all then sort. Use a sort key on time with `ScanIndexForward: false` and `Limit: 1`.
- Lookup by a non-key attribute (by URL, name, email) done as query-all then find. Add a GSI (multi-attribute GSI keys are supported, so you don't need concatenated strings), or a lookup item keyed by that value.
- Per-item `GetItem` in a loop. Use `BatchGetItem` (100 keys / 16 MB per call; retry `UnprocessedKeys`).
- A read-then-act path whose correctness depends on the read itself, with no conditional write afterwards. If the write that follows is conditional, an eventually consistent read is fine: retry on `ConditionalCheckFailed`. Strongly consistent reads cost 2× and aren't available on GSIs.

## Writes and races
- `PutItem` of a previously read item without a `ConditionExpression` is a lost update. Use a version attribute (`version = :expected`, then `SET version = version + 1`), or `UpdateItem` on just the changed fields. Every partial update must bump the version too, or a stale full put will pass the check.
- Counters done as read-modify-write cause retry storms under contention. Use `UpdateItem ADD`. A global counter on one item is capped at 1,000 WCU/s, so shard it.
- Uniqueness via "query GSI, then put". Use a guard item `PK = "email#<value>"` with `attribute_not_exists(PK)`, together with the main item in a `TransactWriteItems`.
- Creating singleton rows (per-tenant key, config) with an unconditional put. Use `attribute_not_exists` and re-read on conflict.
- Transactions: max 100 items / 4 MB, and 2× capacity even when cancelled. Concurrent transactions on the same item fail with `TransactionConflict`, which the SDK doesn't retry. Bulk operations sized by user data hit the limit; transactions on a hot item contend.
- Unbounded parallel deletes or writes. Use `BatchWriteItem` (25 per call) with limited concurrency, and retry `UnprocessedItems`.

## Keys, indexes, throughput
- Hot keys: sustained traffic on one partition above 1,000 WCU / 3,000 RCU. Adaptive capacity can split a big item collection by sort key, so a large tenant under one key is often fine. That doesn't work when the sort key always increases (timestamps), when the table has an LSI, or for a single item. Then shard (`orgId#<bucket>`) or cache reads (DAX or app cache).
- A GSI that can't keep up with writes (low-cardinality key, under-provisioned) throttles writes to the base table. Treat a hot GSI key, including constant sparse-queue keys like `"1"`, as a hot table key.
- An LSI caps each item collection at 10 GB, and hitting it fails writes.
- Write cost is 1 WCU per KB of item size, and a GSI pays it again on every write that touches projected attributes. Wide, frequently updated items with `ALL` projections are expensive long before the 400 KB item limit. A narrow projection only helps if queries don't then need a base-table read.
- Soft-deleted rows that stay in the GSI the hot path queries. Remove the GSI key attribute on delete (sparse index), or move the row to a history table.

## TTL and lifecycle
- Tables for logs, sessions, events, grants, tokens or tombstones with no TTL attribute. Check both the code that writes the attribute and the table definition that enables TTL on it.
- TTL deletes items *typically within a few days* of expiry, and until then they still come back from reads. Sessions, tokens, leases and grants must also filter on `expiresAt > now` when read. Relying on TTL alone is a correctness bug, and a security bug for tokens.

## Capacity and IaC cross-check
- On-demand still throttles: traffic above 2× the previous peak within 30 minutes, and the default per-table quota. Pre-warm before launches. Provisioned autoscaling reacts over minutes, and burst capacity covers only about 5 minutes.
- Every access pattern in code has its GSI in the IaC, and the reverse: unused GSIs are pure write cost. Compare against any `CreateTable` definitions in code (local/test setup); they drift.
- Table-per-tenant designs hit the per-region table quota (2,500 by default).
