# DynamoDB checks

For redesigning keys, GSIs or access patterns, use AWS's `amazon-dynamodb` skill if it's installed (aws/agent-toolkit-for-aws). This file only covers what to flag when reviewing code.

## Reads
- `Scan` anywhere outside a one-off admin/migration path, and especially `Scan` followed by filtering in code. A `FilterExpression` doesn't help: you pay RCU for every item read, not every item returned.
- `Query` on a partition that grows with history (all workspaces/sessions/events of an org) without `Limit` + `ExclusiveStartKey`. One page is capped at 1 MB. Code that ignores `LastEvaluatedKey` silently truncates; code that loops it loads everything into memory.
- "Latest X" done as query-all then sort. Use a sort key on time with `ScanIndexForward: false` and `Limit: 1`.
- Looking up by an attribute that isn't a key (by URL, by name, by email) via query-all-then-find. Add a GSI, or a guard/lookup item keyed by that value.
- Per-item `GetItem` in a loop. Use `BatchGetItem` (100 keys max per call, handle `UnprocessedKeys`).
- `GetItem` without `ConsistentRead: true` on a lock, claim, or read-before-conditional-write path. Reads are eventually consistent by default; GSIs are always eventually consistent.

## Writes and races
- `PutItem` of a previously read item with no `ConditionExpression`. That's a lost update. Use a version attribute (`version = :expected`, then `SET version = version + 1`) or `UpdateItem` on just the changed fields.
- Partial `UpdateItem`s that don't bump the version used by other writers. A later versioned `put` of a stale read then passes and undoes them.
- Uniqueness via "query GSI, then put". Use a guard item `PK = "email#<value>"` with `attribute_not_exists(PK)`, ideally inside a `TransactWriteItems` with the main item.
- Creating singleton rows (per-tenant key, counter, config) with an unconditional put. Two instances can both create one; use `attribute_not_exists` and re-read on conflict.
- `TransactWriteItems` is capped at 100 items. Bulk operations sized by user data will hit it.
- Unbounded parallel deletes/writes. Use `BatchWriteItem` (25 per call) with limited concurrency, and handle `UnprocessedItems`.

## Keys, indexes, lifecycle
- Soft-deleted rows that stay in the GSI the hot path queries. Remove the GSI key attribute on delete (sparse index), or move the row to a history table.
- Tables for logs, sessions, events, grants, tokens or tombstones with no TTL attribute. Check both the code that writes `expiresAt`/`ttl` and the table definition that enables TTL on it.
- Constant partition values (`"1"`, `"pending"`) for queue-like sparse GSIs. Fine for low volume; shard as `<n>#<shard>` if it's a work queue for many workers.
- A large tenant on one partition key (audit log by `orgId`) with heavy writes. Each partition key allows about 1,000 WCU/s; shard the key (`orgId#<bucket>`).
- GSI with `ALL` projection on a wide, hot table. It doubles write cost; project only what the query needs.
- Items that append to a list/map attribute forever. The item size limit is 400 KB.

## Infra-as-code cross-check
- Every access pattern in code has its GSI in Terraform/CDK, and the reverse: unused GSIs are pure write cost. Compare the IaC against any `CreateTable` definitions in code (local/test setup); they drift.
- TTL enabled on the attribute the code actually writes.
- `PAY_PER_REQUEST`, or provisioned capacity with autoscaling. Fixed small provisioned capacity throttles under bursts.
