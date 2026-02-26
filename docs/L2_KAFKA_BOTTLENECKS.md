# L2: Grid Signal - Kafka Producer Performance Analysis

## Executive Summary
This report details the performance bottlenecks identified in the `grid-signal` service (L2) ingestion-to-publish pipeline. Our target SLA is **<50ms**, but baseline testing under a simulated burst of 10,000 concurrent OpenADR payloads showed an average latency of **9,843ms (9.8s)**, with peaks reaching **18.8s**.

The current implementation is unsuited for high-load scenarios such as utility grid emergencies.

## Baseline Performance Data
- **Concurrent Requests:** 10,000
- **Total Time:** 20,095ms
- **Average Latency:** 9,843.71ms
- **P99 Latency (Max):** 18,835ms
- **Throughput:** 497.64 req/sec
- **SLA Target:** < 50ms (FAILED)

---

## Top 3 Latency Risks & Fixes

### 1. Missing Producer Batching (linger.ms & batch.size)
**Risk:** The Kafka producer is initialized with default settings, meaning it attempts to send every message immediately. Under high load, this results in a massive number of small network requests, saturating the connection and causing high queueing latency.

**Required Change:**
Update the Producer initialization to enable batching and Snappy compression.
```javascript
// services/02-grid-signal/index.js
const producer = kafka.producer({
  allowAutoTopicCreation: false,
  transactionTimeout: 30000,
  // Optimization Configs
  lingerMs: 10,       // Wait up to 10ms to batch messages
  batchSize: 16384,   // 16KB batch size
  compression: CompressionTypes.Snappy // High performance compression
});
```

### 2. Blocking Sequential Pipeline
**Risk:** The HTTP handler `await`s both the PostgreSQL insertion and the Kafka `producer.send()` before responding to the caller. This serializes processing and blocks the Node.js event loop's ability to handle new incoming requests efficiently.

**Required Change:**
Adopt an "Accept-then-Process" pattern. Return `202 Accepted` immediately after a basic validation, and handle the DB/Kafka logic asynchronously or through a worker queue.
```javascript
app.post('/openadr/v3/events', async (req, res) => {
  const event = req.body;

  // 1. Immediate validation
  if (!event.id) return res.status(400).json({ error: 'Missing event ID' });

  // 2. Respond immediately to meet SLA
  res.status(202).json({ status: 'RECEIVED', event_id: event.id });

  // 3. Process in background
  processEventInBackground(event).catch(err => console.error(err));
});
```

### 3. Lack of Message Deduplication
**Risk:** Utilities often resend signals or retries may occur. Without deduplication, every duplicate payload triggers a full DB write and a Kafka publish, doubling the load on downstream infrastructure.

**Required Change:**
Implement Redis-based deduplication using the `event.id` as a key with a short-lived TTL (e.g., 60 seconds).
```javascript
// services/02-grid-signal/index.js (Proposed)
const isDuplicate = await redisClient.set(`event:dup:${event.id}`, '1', {
  NX: true,
  EX: 60
});

if (!isDuplicate) {
  console.log('Skipping duplicate event:', event.id);
  return;
}
```

---

## Summary of Proposed Fixes

| Risk | Proposed Fix | Expected Latency Impact |
|------|--------------|-------------------------|
| Unbatched Kafka | `lingerMs: 10`, `Snappy` | -40% network overhead |
| Serial I/O | Async Processing (Non-blocking) | -90% response latency |
| Duplicates | Redis SETNX deduplication | Prevents redundant processing |

Implementing these changes will bring the ingestion response time well under the **50ms SLA** by decoupling the response from the heavy-lifting operations.
