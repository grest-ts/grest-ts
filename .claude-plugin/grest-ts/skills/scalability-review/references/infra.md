# Infra checks

Read the IaC (Terraform/CDK/CloudFormation, Beanstalk `.ebextensions`, k8s manifests, compose files) together with the code. A limit in one often explains a constraint in the other.

## Capacity and availability
- `max_instances = 1`, `desired_count = 1`, `replicas: 1`, or `SingleInstance` environments for anything user-facing. Find out *why* it's pinned: usually in-memory state (see `multi-instance.md`). Report the reason, not just the number.
- One min/max setting shared by several services, so one service that can't scale blocks the others.
- Burstable instances (t2/t3/t4g) on hot paths: proxies terminating TLS, websocket hubs, CPU-heavy workers. Their CPU credits run out under sustained load.
- Single AZ, single subnet, single NAT gateway, single provider location/region. Look for code that always picks "the first subnet" or a hard-coded location.
- No autoscaling trigger, or one on CPU only for a connection-bound service (websockets, proxies). Scale on connections or network instead.
- Proxy/web-server limits: default nginx `worker_connections` and file-descriptor limits; each proxied websocket uses two connections.
- Load-balancer idle timeout vs long requests and websockets.

## Deploys
- All-at-once deploys or `SingleInstance` environments mean downtime, and every in-flight job restarts.
- Immutable/rolling deploys briefly run old and new versions side by side. In-memory pub/sub and caches split across them, and schemas must be compatible both ways.
- No drain or shutdown hook (see `multi-instance.md`).

## Quotas and hard caps
- Cloud and API rate limits shared by all tenants under one account/token/project (VM providers, GitHub App, LLM keys, STS, KMS). One busy tenant can exhaust the quota for everyone.
- Per-project or per-account resource quotas (servers, IPs, snapshots, firewalls and resources per firewall, ENIs).
- CDN invalidation concurrency limits, when every publish invalidates.
- DNS label ≤ 63 chars and hostname ≤ 253, for generated hostnames that concatenate IDs, slugs and service names.
- Subnet sizes vs expected fleet: a /20 has ~4k usable IPs.
- Storage with no lifecycle rules: S3 prefixes, snapshots and images that are never expired.

## Data stores
- Missing TTLs and unused or missing indexes compared with the code's access patterns (see `dynamodb.md`).
- Single-writer or single-node databases that the app assumes are shared.
