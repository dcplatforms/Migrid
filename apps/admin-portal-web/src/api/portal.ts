import type { StatusTone } from "../components/StatusPill";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

/* ---- L1 Physics Engine · Charging Sessions ---- */

export interface SessionRow {
  id: string;
  driver: string;
  vehicle: string;
  energyKwh: number;
  variancePct: number;
  varianceTone: StatusTone;
  status: string;
  statusTone: StatusTone;
}

export interface SessionsSummary {
  sessionsToday: number;
  energyMwh: number;
  physicsPassRatePct: number;
  flagged: number;
}

export const fetchSessions = (signal?: AbortSignal) =>
  Promise.all([
    getJson<SessionsSummary>("/api/sessions/summary", signal),
    getJson<{ sessions: SessionRow[] }>("/api/sessions", signal),
  ]).then(([summary, list]) => ({ summary, sessions: list.sessions }));

/* ---- L4 Market Gateway · VPP Market Bids ---- */

export interface BidRow {
  id: string;
  market: string;
  product: string;
  capacity: string;
  clearing: string;
  status: string;
  tone: StatusTone;
}

export interface MarketSummary {
  dispatchableMw: number;
  revenue30dK: number;
  clearedBids: number;
  avgClearingUsd: number;
}

export const fetchMarket = (signal?: AbortSignal) =>
  Promise.all([
    getJson<MarketSummary>("/api/market/summary", signal),
    getJson<{ bids: BidRow[] }>("/api/market/bids", signal),
  ]).then(([summary, list]) => ({ summary, bids: list.bids }));

/* ---- L6 Engagement Engine · Driver Management ---- */

export interface DriverRow {
  name: string;
  depot: string;
  score: number;
  tokens: string;
  tier: string;
  tierTone: StatusTone;
  status: string;
  statusTone: StatusTone;
}

export interface DriversSummary {
  activeDrivers: number;
  avgEngagement: number;
  tokensMinted30dM: number;
  v2gParticipationPct: number;
}

export const fetchDrivers = (signal?: AbortSignal) =>
  Promise.all([
    getJson<DriversSummary>("/api/drivers/summary", signal),
    getJson<{ drivers: DriverRow[] }>("/api/drivers", signal),
  ]).then(([summary, list]) => ({ summary, drivers: list.drivers }));
