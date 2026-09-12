# ADR-002: Event Buffering with Redis Streams

## Status
Accepted

## Context
During cascading outages, external monitoring systems (Prometheus, Datadog, CloudWatch) can trigger thousands of alert webhooks per second. Writing each alert synchronously to PostgreSQL exhausts the database connection pool, creates lock contention, and causes webhook requests to time out ($> 50\text{ms}$). We require a high-throughput, persistent asynchronous message buffer to decouple ingestion from correlation and storage.

## Decision
We select **Redis Streams** as the primary asynchronous buffer between the Ingress Gateway and downstream Correlation Workers.
- Ingress Gateway writes incoming CloudEvents to `stream:telemetry:raw` using `XADD` and immediately responds with `HTTP 202 Accepted`.
- Workers consume events in parallel using Redis Consumer Groups (`XREADGROUP`), guaranteeing at-least-once delivery with message acknowledgments (`XACK`).
- Redis AOF (Append-Only File) persistence is enabled to ensure zero message loss across unexpected container restarts.

## Alternatives Considered
1. **Direct Synchronous Write to PostgreSQL:** Ingress writes directly to relational tables. Rejected because alert storms would saturate database IOPS and cause HTTP timeouts.
2. **Apache Kafka:** Industry-standard distributed log. Rejected for MVP because Kafka requires massive operational overhead (ZooKeeper/KRaft, JVM memory footprint, complex configuration) that is unjustified for a greenfield platform when Redis already provides high-throughput streams ($> 50{,}000$ ops/sec) with negligible resource footprint.
3. **RabbitMQ:** Excellent AMQP message broker. Redis was chosen over RabbitMQ because Redis is already required for caching, rate limiting, and pub/sub, consolidating operational dependencies.

## Consequences
### Positive
- Sub-5ms webhook response latency at the ingress tier.
- Complete absorption of alert spikes without downstream database pressure.
- Single infrastructure dependency for caching, rate-limiting, and streaming.
- Consumer groups enable trivial horizontal auto-scaling of correlation workers.

### Negative / Trade-offs
- Stream retention must be bounded (`MAXLEN ~ 100000`) to prevent unbounded Redis RAM growth.
- At-least-once delivery requires correlation workers to be idempotent (handled via alert fingerprint deduplication).
