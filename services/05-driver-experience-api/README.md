# L5: Driver Experience API

**Version:** 4.0.0
**Status:** ✅ Complete (Q4 2025)
**Phase:** Driver Experience

## Overview

Backend API for the driver mobile app, providing smart routing, charging recommendations, and voice command processing.

## Features

- **Session Management**: Start/stop charging sessions
- **Smart Routing**: Optimal charger location recommendations
- **Voice Commands**: Natural language processing for hands-free control
- **Rewards Integration**: Real-time token balance and earning history

## API Endpoints

- `POST /auth/login` - Driver authentication
- `GET /chargers/nearby` - Find nearby available chargers
- `POST /sessions/start` - Start charging session
- `GET /rewards/balance` - Get token balance
- `POST /voice/command` - Process voice command

---

*Part of MiGrid Phase 4: Driver Experience*
