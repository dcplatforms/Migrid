# L10 Token Engine: Weekly Product Update (June 2026 - v4.3.8)

## 1. L10 Web3 & Rewards Report
*   **Hardware-Aware Resilience**: Implemented the `applyHardwarePenalty` logic, reducing token rewards by 0.05x per active regional alarm (capped at 0.30x). This synchronizes L10 with L4 Market Gateway v3.8.9, ensuring that behavioral rewards reflect real-time hardware health and grid stress.
*   **Architectural Parity**: Consolidated the `extractSiteId` helper to maintain a single source of truth for site identification across the stack (L1/L2/L3/L4/L7/L10).
*   **L11 ML Engine Alignment**: Hardened telemetry precision by enforcing strict 4-decimal string formatting (`safeFloat`) for all `physics_score` and `confidence_score` logs. This provides the ML Engine with deterministic, high-fidelity ground truth for Phase 6 auditing.
*   **Engineering Status**: Bumped service to **v4.3.8**. All 30 unit tests, including new hardware penalty scenarios, are passing.

## 2. Backlog Updates
*   **[L10-P2] COMPLETED**: Implement Hardware Health Penalty in reward logic (Synchronized with L4/L6).
*   **[L10-P4] PLANNED**: Integrate KMS/HSM for production private key management (Security Phase 2).
*   **[L10-P5] PLANNED**: Implement ERC-20 staking mechanics for long-term grid support (Web3 Maturity Phase).
*   **[L10-P7] NEW**: Implement dynamic gas-price adjustments for Polygon batch minting.

## 3. Engineering Execution
*   **Logic**: Added `applyHardwarePenalty` to `index.js` using Redis `l4:regional:alarms:<ISO>` as the trigger.
*   **Refactor**: Removed duplicate `extractSiteId` function to improve maintainability.
*   **Hardening**: Integrated `safeFloat` for all telemetry persistence.
*   **Version Upgrade**: Bumped L10 to **v4.3.8**.
*   **Testing**: Created `tests/hardware_penalty.test.js` validating penalty caps and telemetry precision.
