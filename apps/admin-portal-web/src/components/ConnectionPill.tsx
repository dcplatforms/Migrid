import { StatusPill } from "./StatusPill";
import type { ConnectionState } from "../hooks/usePolling";

interface ConnectionPillProps {
  status: ConnectionState;
  liveLabel: string;
}

/** Small Live/Connecting/Offline indicator driven by a polling hook's state. */
export const ConnectionPill = ({ status, liveLabel }: ConnectionPillProps) => {
  if (status === "live") return <StatusPill tone="success" label={liveLabel} pulse />;
  if (status === "connecting") return <StatusPill tone="warning" label="Connecting…" />;
  return <StatusPill tone="danger" label="Offline · fallback data" />;
};
