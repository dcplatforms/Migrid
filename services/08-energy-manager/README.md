# L8: Energy Manager

**Version:** 1.1.0
**Status:** ✅ Complete (Q1 2025)
**Phase:** Foundation

## Overview

Site-level Dynamic Load Management (DLM) that monitors building load via Modbus and adjusts EV charging to stay within grid connection limits.

## Features

- **Modbus Integration**: TCP/RTU support for energy meters
- **Dynamic Load Management**: Automatic charging power adjustment
- **Grid Safety**: Never exceed `grid_connection_limit_kw`
- **Real-time Monitoring**: Live site energy dashboard

## Load Management Algorithm

```
available_kw = grid_limit_kw - building_load_kw
distribute_power(ev_fleet, available_kw)
```

## Environment Variables

```bash
MODBUS_HOST=192.168.1.100
MODBUS_PORT=502
GRID_CONNECTION_LIMIT_KW=500
DATABASE_URL=postgresql://...
```

---

*Part of MiGrid Phase 1: Foundation*
