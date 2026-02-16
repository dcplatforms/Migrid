# Sentinel's Journal 🛡️

## 2025-05-16 - [IDOR in Multi-tenant Microservices]
**Vulnerability:** Insecure Direct Object Reference (IDOR) and cross-fleet data enumeration.
**Learning:** While the authentication middleware correctly identifies the user's `fleet_id`, individual service endpoints often fail to enforce this constraint in their SQL queries, allowing authenticated users to access resources belonging to other fleets.
**Prevention:** Every database query in a tenant-aware service must explicitly filter by the tenant identifier (e.g., `fleet_id`) retrieved from the verified JWT.
