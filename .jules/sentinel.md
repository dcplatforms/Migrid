# Sentinel's Journal 🛡️

## 2025-05-16 - [IDOR in Multi-tenant Microservices]
**Vulnerability:** Insecure Direct Object Reference (IDOR) and cross-fleet data enumeration.
**Learning:** While the authentication middleware correctly identifies the user's `fleet_id`, individual service endpoints often fail to enforce this constraint in their SQL queries, allowing authenticated users to access resources belonging to other fleets.
**Prevention:** Every database query in a tenant-aware service must explicitly filter by the tenant identifier (e.g., `fleet_id`) retrieved from the verified JWT.

## 2025-05-19 - [Login Brute Force and Information Leakage]
**Vulnerability:** Missing rate limiting on login endpoints and exposure of internal error messages.
**Learning:** Public-facing authentication endpoints are primary targets for brute-force attacks. Additionally, returning raw database error messages (`error.message`) leaks internal schema details.
**Prevention:** Implement rate limiting on sensitive endpoints and ensure all API responses use generic error messages, with detailed errors logged only on the server.

## 2025-05-22 - [Widespread Information Leakage in API Errors]
**Vulnerability:** API endpoints returning raw database and internal error messages (`err.message`).
**Learning:** Development-focused error handling often prioritizes quick debugging over security, but returning raw errors in production can leak schema details and internal logic.
**Prevention:** Always use generic error messages in API responses (e.g., 'An internal server error occurred') and log detailed errors to the server console or a logging service.
