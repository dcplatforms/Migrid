# MiGrid: The Vertically Integrated EV Fleet Operating System

MiGrid is an open-source, enterprise-grade operating system designed to manage electric vehicle fleets not just as transportation assets, but as active, revenue-generating participants in the energy grid. It provides a unified, 10-layer platform that spans from the physics of energy transfer to the tokenization of grid-supportive actions.

Our core philosophy is built on three invariants:
1.  **"Do not trust the driver; verify the physics."** Every charging session is audited to ensure energy dispensed matches energy received.
2.  **"The Grid is a partner, not just a plug."** We actively manage site load, respond to utility signals, and prioritize grid stability.
3.  **"Every electron must be a tokenized asset."** Grid-supportive actions are measured, valued, and rewarded, creating a powerful incentive layer.

---

## The MiGrid Innovative Advantage

While many platforms manage EV charging, MiGrid is architected for the future of decentralized energy. Our advantage lies in our vertically integrated, holistic approach:

*   **Full-Stack V2G/VPP Control:** MiGrid is built from the ground up to support FERC 2222, enabling fleets to aggregate their EVs into 100kW+ Virtual Power Plants (VPPs) and bid them into wholesale energy markets (CAISO, PJM, ERCOT).
*   **Fintech-Grade Ledger:** We treat every kilowatt-hour and every dollar as a high-precision asset. By using PostgreSQL with TimescaleDB and enforcing decimal-only calculations, we eliminate rounding errors and ensure financial integrity from the charger to the balance sheet.
*   **Tokenized Driver Incentives:** We use a built-in Web3 rewards system (via the [Open-Wallet Framework](https://github.com/ThomasC3/open-wallet)) to incentivize drivers for grid-friendly behavior, such as participating in smart charging or V2G events. This turns a cost center (charging) into a shared revenue opportunity.
*   **Hardware Agnostic:** Through universal hardware abstraction (OCPP 2.0.1, ISO 15118), MiGrid avoids vendor lock-in and provides a single pane of glass for managing a diverse set of charging hardware.

---

## Technical Architecture: The 10-Layer Stack

MiGrid is built as a monorepo of microservices communicating via a Kafka event bus. This design ensures scalability, resilience, and clear separation of concerns.

| Layer | Name | Description | Service / App |
| :--- | :--- | :--- | :--- |
| **L1** | **Physics** | The "Green Audit." Verifies energy dispensed vs. received via telematics. | `01-physics-engine` |
| **L2** | **Grid** | OpenADR 3.0 VEN for managing utility signals and demand response. | `02-grid-signal` |
| **L3** | **VPP** | Aggregates EV/BESS assets into Virtual Resources for market bidding. | *(Future Service)* |
| **L4** | **Market** | US-Centric energy arbitrage engine using Locational Marginal Pricing (LMP). | *(Future Service)* |
| **L5** | **Driver Experience** | Voice-activated UI, smart routing, and real-time charging status. | `driver-app-mobile` |
| **L6** | **Engagement** | Fleet CRM, targeted app banners, and support ticketing. | `admin-portal-web` |
| **L7** | **Device** | Universal hardware abstraction (OCPP 2.0.1, ISO 15118, V2G). | `07-device-gateway` |
| **L8** | **Energy** | Site-level Dynamic Load Management (DLM) and grid safety. | *(Handled by L7/L2)* |
| **L9** | **Commerce** | Fintech-grade billing, tariffs, and subscription management. | `09-commerce-engine` |
| **L10**| **Token** | Web3 rewards & staking for driver incentives via the Open-Wallet Framework. | `10-token-engine` |

### Core Technologies
*   **Backend:** Node.js, Express.js, TypeScript (planned)
*   **Database:** PostgreSQL with TimescaleDB for time-series data
*   **Event Bus:** Apache Kafka
*   **Frontend:** React, TypeScript, Fluent UI, Chart.js
*   **Containerization:** Docker

---

## Core Use-Cases

1.  **Managed Fleet Charging (Smart Charging):**
    *   **Scenario:** A fleet manager needs to ensure 50 vehicles are fully charged by 6 AM, at the lowest possible energy cost.
    *   **MiGrid Solution:** The platform ingests utility TOU (Time-of-Use) rates and LMP data. It automatically creates optimized OCPP Smart Charging Profiles for each vehicle, concentrating charging during the cheapest off-peak hours while respecting the site's `grid_connection_limit_kw`.

2.  **Virtual Power Plant (VPP) Dispatch:**
    *   **Scenario:** The grid operator (e.g., CAISO) issues a demand response event, calling for energy discharge.
    *   **MiGrid Solution:** The L2 Grid service receives the OpenADR signal. The L3 VPP service identifies all V2G-capable, plugged-in vehicles with sufficient state-of-charge and aggregates them. It then dispatches ISO 15118 V2G commands to discharge energy back to the grid, generating revenue for the fleet.

3.  **Driver Incentive for Grid Support:**
    *   **Scenario:** A driver returns to the depot and plugs in during a peak price spike.
    *   **MiGrid Solution:** The system prompts the driver (via the mobile app) to delay their charging until off-peak hours. When the driver accepts, the L10 Token Engine listens for the `smart_charge_completed` event, calculates the dollar value of the grid support, and mints "MiGrid Points" to the driver's Open-Wallet.

4.  **Residential Charging Reimbursement:**
    *   **Scenario:** A driver charges their fleet vehicle at home.
    *   **MiGrid Solution:** The L1 Physics engine ingests vehicle telematics data to verify the energy received. The L9 Commerce engine uses the driver's home address to pull the precise utility TOU tariff and calculates an exact reimbursement amount, ensuring the driver is paid exactly what they spent.

---

## Getting Started (Local Development)

### Prerequisites
*   [Docker](https://www.docker.com/get-started) and Docker Compose
*   [Node.js](https://nodejs.org/) (v18+)
*   [Git](https://git-scm.com/)

### Running the Stack

1.  **Clone the repositories:**
    ```bash
    # Clone the main MiGrid monorepo
    git clone https://github.com/ThomasC3/migrid.git
    
    # Clone the Open-Wallet service (required for L10)
    git clone https://github.com/ThomasC3/open-wallet.git
    
    # Position the open-wallet repo alongside the migrid repo
    # Your directory structure should be:
    # ./
    # ├── migrid/
    # └── open-wallet/
    ```

2.  **Navigate to the MiGrid directory:**
    ```bash
    cd migrid
    ```

3.  **Start the entire platform:**
    ```bash
    docker-compose up --build
    ```

This command will build and start all the services defined in `docker-compose.yml`, including the PostgreSQL database, Kafka, and the individual microservices.

**Accessing the Admin Portal:**
*   **URL:** `http://localhost:5173` (or the port specified by the Vite server)
*   The portal provides a real-time view of the **L8 Energy** layer via the "Live Site Energy" dashboard.
