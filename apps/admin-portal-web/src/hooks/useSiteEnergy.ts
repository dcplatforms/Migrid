import { useEffect, useRef, useState } from "react";
import {
  fetchSiteEnergy,
  fetchSiteEnergySeries,
  type SiteEnergy,
  type SeriesPoint,
} from "../api/siteEnergy";

export type ConnectionState = "connecting" | "live" | "offline";

export interface SiteEnergyState {
  data: SiteEnergy | null;
  series: SeriesPoint[];
  status: ConnectionState;
  lastUpdated: Date | null;
}

/**
 * Polls the L8 Energy Manager telemetry API on an interval. Reports a
 * connection state so the UI can show whether it is rendering live backend
 * data or has fallen back (e.g. the service is down).
 */
export function useSiteEnergy(pollMs = 5000, siteId?: string): SiteEnergyState {
  const [data, setData] = useState<SiteEnergy | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [status, setStatus] = useState<ConnectionState>("connecting");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const failures = useRef(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const load = async () => {
      try {
        const [energy, seriesResp] = await Promise.all([
          fetchSiteEnergy(siteId, controller.signal),
          fetchSiteEnergySeries(siteId, controller.signal),
        ]);
        if (!active) return;
        failures.current = 0;
        setData(energy);
        setSeries(seriesResp.points);
        setStatus("live");
        setLastUpdated(new Date());
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        failures.current += 1;
        // Only flip to offline after a couple of consecutive misses to avoid
        // flicker on a single dropped poll.
        if (failures.current >= 2) setStatus("offline");
      }
    };

    load();
    const id = setInterval(load, pollMs);
    return () => {
      active = false;
      controller.abort();
      clearInterval(id);
    };
  }, [pollMs, siteId]);

  return { data, series, status, lastUpdated };
}
