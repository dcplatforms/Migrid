# Sentinel's Journal 🛡️

## 2025-05-16 - [IDOR in Multi-tenant Microservices]
**Vulnerability:** Insecure Direct Object Reference (IDOR) and cross-fleet data enumeration.
**Learning:** While the authentication middleware correctly identifies the user's `fleet_id`, individual service endpoints often fail to enforce this constraint in their SQL queries, allowing authenticated users to access resources belonging to other fleets.
**Prevention:** Every database query in a tenant-aware service must explicitly filter by the tenant identifier (e.g., `fleet_id`) retrieved from the verified JWT.

## 2025-05-19 - [Login Brute Force and Information Leakage]
**Vulnerability:** Missing rate limiting on login endpoints and exposure of internal error messages.
**Learning:** Public-facing authentication endpoints are primary targets for brute-force attacks. Additionally, returning raw database error messages (`error.message`) leaks internal schema details.
**Prevention:** Implement rate limiting on sensitive endpoints and ensure all API responses use generic error messages, with detailed errors logged only on the server.

## 2025-05-21 - [Unauthenticated Sensitive Endpoints and Rate Limiting]
**Vulnerability:** Registration endpoints lacked rate limiting, and several internal services (Commerce, VPP Aggregator) expose unauthenticated sensitive endpoints.
**Learning:** Public registration endpoints are highly susceptible to automated abuse if not IP-rate limited. Some services were found with unauthenticated `POST /tariffs` and `POST /resources/register` endpoints, representing significant security gaps.
**Prevention:** Always apply IP-based rate limiting to registration and ensure all sensitive endpoints across all microservices are protected by the `authenticateToken` middleware.

## 2026-01-23 - [Multi-tenant Tariff Selection IDOR]
**Vulnerability:** Insecure Direct Object Reference (IDOR) in the tariff selection endpoint.
**Learning:** Drivers were able to select any tariff ID in the system regardless of its fleet association, bypassing multi-tenancy isolation and potentially accessing unauthorized pricing structures.
**Prevention:** All resource-related updates in a multi-tenant system must explicitly verify that the target resource (e.g., `tariff_id`) is owned by or associated with the user's tenant (e.g., `fleet_id`).

## 2026-03-12 - [V2G Dispatch IDOR in VPP Aggregator]
**Vulnerability:** Insecure Direct Object Reference (IDOR) in the V2G dispatch endpoint.
**Learning:** The `POST /dispatch/v2g` endpoint allowed any authenticated user to trigger a discharge on any charger by its `chargePointId` (serial number) because it lacked a fleet ownership check in the database query.
**Prevention:** Sensitive control endpoints must cross-reference the target resource's owner (e.g., `fleet_id`) against the user's authenticated context before executing high-impact actions like power dispatch.

## 2026-04-22 - [Kafka Consumer Availability Risk]
**Vulnerability:** Missing high-level error handling in Kafka `eachMessage` handlers.
**Learning:** A single malformed JSON payload or unhandled exception in the message processing logic would crash the entire consumer, leading to a denial of service for the reward engine.
**Prevention:** Always wrap the body of `eachMessage` handlers in a `try...catch` block to log errors and allow the consumer to continue processing subsequent messages.

## 2026-04-23 - [Achievement Self-Awarding Logic Flaw]
**Vulnerability:** Privilege escalation via a public endpoint that allowed users to trigger their own rewards.
**Learning:** The `POST /achievements/award` endpoint lacked server-side verification of achievement prerequisites, trusting the client-side request to determine if a reward was deserved. Even with IDOR protection, the existence of such an endpoint is a critical design flaw in an automated engagement system.
**Prevention:** Never expose endpoints that allow users to claim or award themselves rewards based solely on a request. Reward logic must be fully server-side and triggered by verified internal events or state changes.

## 2026-04-24 - [PII Leakage in Unauthenticated Grid Reports]
**Vulnerability:** The `/openadr/v3/reports` endpoint was unauthenticated and returned raw `safetyContext` containing PII (`vin`, `vehicle_id`).
**Learning:** High-fidelity reporting often aggregates data from lower-level services (like L1 Physics) which may include sensitive device identifiers not suitable for broad internal or external APIs.
**Prevention:** Always apply authentication middleware to reporting endpoints and explicitly mask sensitive fields in objects retrieved from caches (Redis) or other microservices before API delivery.
