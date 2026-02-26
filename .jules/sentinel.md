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
