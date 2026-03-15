<div align="center">

# 🚀 MiGrid Deployment Guide

**Version 10.0.0** • **January 2026**

[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com)
[![Node](https://img.shields.io/badge/Node.js-18%2B-brightgreen.svg)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B-blue.svg)](https://www.postgresql.org)

[Quick Start](#quick-start) • [Configuration](#environment-variables) • [API Examples](#api-examples) • [Troubleshooting](#troubleshooting)

</div>

---

## ⚡ Quick Start

### 📋 Prerequisites

<table>
<tr>
<td width="50%" valign="top">

**Required:**
- ✅ Docker & Docker Compose
- ✅ Node.js 18+ (for development)
- ✅ PostgreSQL 15+ with TimescaleDB
- ✅ Git

</td>
<td width="50%" valign="top">

**System Requirements:**
- 💻 8GB RAM minimum (16GB recommended)
- 💾 50GB disk space
- 🌐 Internet connection for blockchain
- 🔐 Port availability (3001-3010, 5173)

</td>
</tr>
</table>

### 🎯 One-Command Deploy

```bash
# Start entire platform
docker-compose up --build
```

**Access Points:**
- 🖥️ **Admin Portal:** http://localhost:5173
- 🔍 **Health Checks:** http://localhost:3001/health (and ports 3002-3010)

---

## 🌐 Service Ports

<table>
<tr>
<td width="15%" align="center"><b>Port</b></td>
<td width="10%" align="center"><b>Layer</b></td>
<td width="35%"><b>Service</b></td>
<td width="40%"><b>Description</b></td>
</tr>
<tr>
<td align="center"><code>:3001</code></td>
<td align="center">⚛️ L1</td>
<td><b>Physics Engine</b></td>
<td>Energy variance calculation & validation</td>
</tr>
<tr>
<td align="center"><code>:3002</code></td>
<td align="center">🌐 L2</td>
<td><b>Grid Signal</b></td>
<td>OpenADR 3.0 VEN demand response</td>
</tr>
<tr>
<td align="center"><code>:3003</code></td>
<td align="center">⚡ L3</td>
<td><b>VPP Aggregator</b></td>
<td>Fleet capacity aggregation for markets</td>
</tr>
<tr>
<td align="center"><code>:3004</code></td>
<td align="center">💹 L4</td>
<td><b>Market Gateway</b></td>
<td>CAISO/PJM wholesale market integration</td>
</tr>
<tr>
<td align="center"><code>:3005</code></td>
<td align="center">📱 L5</td>
<td><b>Driver Experience API</b></td>
<td>Mobile app backend with JWT auth</td>
</tr>
<tr>
<td align="center"><code>:3006</code></td>
<td align="center">🎮 L6</td>
<td><b>Engagement Engine</b></td>
<td>Gamification, leaderboards & achievements</td>
</tr>
<tr>
<td align="center"><code>:3007</code><br><code>:9220</code></td>
<td align="center">🔌 L7</td>
<td><b>Device Gateway</b></td>
<td>OCPP 2.1 & 2.0.1 charger communication<br>(HTTP + WebSocket)</td>
</tr>
<tr>
<td align="center"><code>:3008</code></td>
<td align="center">📊 L8</td>
<td><b>Energy Manager</b></td>
<td>Dynamic Load Management (DLM)</td>
</tr>
<tr>
<td align="center"><code>:3009</code></td>
<td align="center">💰 L9</td>
<td><b>Commerce Engine</b></td>
<td>Billing, tariffs & reimbursements</td>
</tr>
<tr>
<td align="center"><code>:3010</code></td>
<td align="center">💎 L10</td>
<td><b>Token Engine</b></td>
<td>Web3 rewards on Polygon</td>
</tr>
<tr>
<td align="center"><code>:5173</code></td>
<td align="center">🖥️</td>
<td><b>Admin Portal</b></td>
<td>React frontend (Vite dev server)</td>
</tr>
</table>

---

## 🗄️ Database Setup

<details open>
<summary><b>1️⃣ Initialize Schema</b></summary>

```bash
# Run migrations
docker exec -i migrid-postgres-1 psql -U migrid -d migrid_core < scripts/migrations/001_init_schema.sql
```

**Creates:**
- ✅ 15+ tables with proper relationships
- ✅ TimescaleDB hypertables for time-series data
- ✅ Indexes for performance optimization
- ✅ Seed data for token reward rules

</details>

<details open>
<summary><b>2️⃣ Seed Demo Data</b></summary>

```bash
# Install dependencies
npm install

# Run seed script
node scripts/seed-data.js
```

**Generates:**
- 🏢 1 demo fleet (Green Transport Co)
- 👤 3 drivers with authentication
- 🚗 3 vehicles (Ford F-150 Lightning, Rivian R1T, Tesla Semi)
- ⚡ 3 OCPP 2.1 & 2.0.1 chargers
- 📊 20 historical charging sessions
- 💹 24 hours of LMP price data

</details>

<details open>
<summary><b>🔐 Demo Credentials</b></summary>

**Login Information:**
```
Email:    alice@demo.com
Password: demo123
```

**Additional test accounts:**
- `bob@demo.com` / `demo123`
- `carol@demo.com` / `demo123`

</details>

---

## 🔧 Environment Variables

<details open>
<summary><b>Production Configuration</b></summary>

Create `.env` file in project root:

```bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Database Configuration
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE_URL=postgresql://user:pass@host:5432/migrid_core
POSTGRES_USER=migrid
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=migrid_core

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Security & Authentication
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
JWT_SECRET=your_256_bit_secret_key_here_change_in_production
JWT_EXPIRATION=7d

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Wholesale Market APIs
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CAISO
CAISO_SC_ID=your_scheduling_coordinator_id
CAISO_API_KEY=your_caiso_api_key
CAISO_BASE_URL=https://api.caiso.com

# PJM
PJM_MEMBER_ID=your_pjm_member_id
PJM_API_KEY=your_pjm_api_key
PJM_BASE_URL=https://api.pjm.com

# ERCOT
ERCOT_MEMBER_ID=your_ercot_member_id
ERCOT_API_KEY=your_ercot_api_key

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Blockchain Configuration
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
POLYGON_RPC_URL=https://polygon-rpc.com
WALLET_PRIVATE_KEY=your_ethereum_private_key_no_0x_prefix
TOKEN_CONTRACT_ADDRESS=0x1234567890abcdef
CHAIN_ID=137

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Grid & Energy Configuration
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GRID_CONNECTION_LIMIT_KW=500
MODBUS_HOST=192.168.1.100
MODBUS_PORT=502
MODBUS_SLAVE_ID=1

# VPP Configuration
VPP_MIN_CAPACITY_KW=100
VPP_BESS_MIN_SOC=20

# LMP Trading Thresholds
LMP_THRESHOLD_BUY=30.00
LMP_THRESHOLD_SELL=100.00

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Service Configuration
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NODE_ENV=production
LOG_LEVEL=info
REDIS_URL=redis://localhost:6379
KAFKA_BROKERS=localhost:9092
```

</details>

<details>
<summary><b>🔐 Security Best Practices</b></summary>

**Production Checklist:**
- [ ] Generate strong JWT secret (min 256 bits)
- [ ] Use environment-specific `.env` files
- [ ] Never commit `.env` to version control
- [ ] Rotate API keys regularly
- [ ] Use secrets management (AWS Secrets Manager, HashiCorp Vault)
- [ ] Enable SSL/TLS for all database connections
- [ ] Use read-only database replicas for reporting
- [ ] Implement API rate limiting

</details>

---

## Health Checks

```bash
# Check all services
for port in 3001 3002 3003 3004 3005 3006 3007 3008 3009 3010; do
  echo "Checking port $port..."
  curl -s http://localhost:$port/health | jq
done
```

---

## Monitoring

### Logs

```bash
# View all logs
docker-compose logs -f

# View specific service
docker-compose logs -f physics-engine
docker-compose logs -f vpp-aggregator
```

### Database Queries

```bash
# Active sessions
docker exec -it migrid-postgres-1 psql -U migrid -d migrid_core -c "SELECT * FROM charging_sessions WHERE end_time IS NULL;"

# VPP capacity
docker exec -it migrid-postgres-1 psql -U migrid -d migrid_core -c "SELECT * FROM vpp_resources;"

# Leaderboard
docker exec -it migrid-postgres-1 psql -U migrid -d migrid_core -c "SELECT * FROM leaderboard ORDER BY rank;"
```

---

## API Examples

### Authentication

```bash
# Register driver
curl -X POST http://localhost:3005/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "secure123",
    "first_name": "Test",
    "last_name": "User",
    "fleet_id": "YOUR_FLEET_ID"
  }'

# Login
curl -X POST http://localhost:3005/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@demo.com",
    "password": "demo123"
  }'
```

### VPP Operations

```bash
# Get available capacity
curl http://localhost:3003/capacity/available

# Register vehicle as VPP resource
curl -X POST http://localhost:3003/resources/register \
  -H "Content-Type: application/json" \
  -d '{
    "vehicle_id": "YOUR_VEHICLE_ID",
    "battery_capacity_kwh": 131,
    "v2g_enabled": true
  }'
```

### Market Gateway

```bash
# Get current LMP prices
curl http://localhost:3004/markets/CAISO/prices

# Submit energy bid
curl -X POST http://localhost:3004/bids/submit \
  -H "Content-Type: application/json" \
  -d '{
    "iso": "CAISO",
    "market_type": "day-ahead",
    "quantity_kw": 500,
    "price_per_mwh": 75.00,
    "delivery_hour": "2026-01-16T14:00:00Z"
  }'
```

### Energy Manager

```bash
# Get current site load
curl http://localhost:3008/load/current

# Apply Dynamic Load Management
curl -X POST http://localhost:3008/dlm/apply
```

---

## Troubleshooting

### Service won't start

```bash
# Check logs
docker-compose logs service-name

# Restart service
docker-compose restart service-name

# Rebuild service
docker-compose up --build service-name
```

### Database connection issues

```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Check connection
docker exec -it migrid-postgres-1 psql -U migrid -d migrid_core -c "SELECT 1;"
```

### Port conflicts

```bash
# Check what's using a port
lsof -i :3001

# Stop conflicting service
kill -9 PID
```

---

## Production Deployment

### Kubernetes

```bash
# Coming soon: Helm charts for k8s deployment
# helm install migrid ./charts/migrid
```

### Security Checklist

- [ ] Change all default passwords
- [ ] Enable TLS/SSL for all services
- [ ] Set up firewall rules
- [ ] Configure backup strategy
- [ ] Enable audit logging
- [ ] Set up monitoring (Prometheus/Grafana)
- [ ] Configure log aggregation (ELK/Loki)

---

## Backup & Recovery

```bash
# Backup database
docker exec migrid-postgres-1 pg_dump -U migrid migrid_core > backup.sql

# Restore database
docker exec -i migrid-postgres-1 psql -U migrid -d migrid_core < backup.sql
```

---

## Performance Tuning

### PostgreSQL

```sql
-- Recommended settings for production
ALTER SYSTEM SET shared_buffers = '4GB';
ALTER SYSTEM SET effective_cache_size = '12GB';
ALTER SYSTEM SET work_mem = '64MB';
```

### TimescaleDB

```sql
-- Optimize chunk intervals
SELECT set_chunk_time_interval('charging_sessions', INTERVAL '7 days');
SELECT set_chunk_time_interval('lmp_prices', INTERVAL '1 day');
```

---

**For questions or support, see the main README or open an issue on GitHub.**
