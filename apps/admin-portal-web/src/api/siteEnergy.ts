import type { StatusTone } from "../components/StatusPill";

export interface Connector {
  id: string;
  vehicle: string;
  status: string;
  kw: number;
  tone: StatusTone;
}

export interface SiteEnergy {
  siteId: string;
  timestamp: string;
  gridLimitKw: number;
  buildingLoadKw: number;
  evLoadKw: number;
  totalLoadKw: number;
  availableKw: number;
  utilizationPct: number;
  safeMode: boolean;
  connectors: Connector[];
  source: string;
}

export interface SeriesPoint {
  t: string;
  totalLoadKw: number;
}

export interface SiteEnergySeries {
  siteId: string;
  unit: string;
  points: SeriesPoint[];
}

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const fetchSiteEnergy = (siteId?: string, signal?: AbortSignal) =>
  getJson<SiteEnergy>(
    `/api/site/energy${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ""}`,
    signal
  );

export const fetchSiteEnergySeries = (siteId?: string, signal?: AbortSignal) =>
  getJson<SiteEnergySeries>(
    `/api/site/energy/series${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ""}`,
    signal
  );
