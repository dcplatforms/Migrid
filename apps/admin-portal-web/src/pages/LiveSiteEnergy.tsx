import { makeStyles, shorthands, tokens, Text, ProgressBar, Button, Tooltip } from "@fluentui/react-components";
import {
  Flash24Regular,
  Battery1024Regular,
  ArrowTrendingLines24Regular,
  PlugConnected24Regular,
  ArrowClockwise20Regular,
  BatteryCharge24Regular,
} from "@fluentui/react-icons";
import { EnergyChart } from "../components/EnergyChart";
import { GlassCard } from "../components/GlassCard";
import { KpiCard } from "../components/KpiCard";
import { PageHeader } from "../components/PageHeader";
import { StatusPill, type StatusTone } from "../components/StatusPill";
import { useSiteEnergy } from "../hooks/useSiteEnergy";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    rowGap: "22px",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    ...shorthands.gap("18px"),
  },
  mainGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2.1fr) minmax(280px, 1fr)",
    ...shorthands.gap("18px"),
  },
  capacityBlock: {
    display: "flex",
    flexDirection: "column",
    rowGap: "10px",
    marginBottom: "18px",
  },
  capacityRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  capacityValue: {
    fontSize: "22px",
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
    fontVariantNumeric: "tabular-nums",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  connectorList: {
    display: "flex",
    flexDirection: "column",
    rowGap: "10px",
  },
  connector: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: "12px",
    ...shorthands.padding("12px", "14px"),
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
    backgroundColor: "var(--surface-soft)",
    ...shorthands.border("1px", "solid", "var(--glass-subtle-border)"),
  },
  connectorMeta: {
    display: "flex",
    flexDirection: "column",
    rowGap: "2px",
    minWidth: 0,
  },
  connectorName: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
});

// Static fallback used only when the L8 telemetry service is unreachable.
const FALLBACK = {
  buildingLoadKw: 75.5,
  evLoadKw: 120.3,
  gridLimitKw: 250,
  connectors: [
    { id: "DEPOT-A · CP-01", vehicle: "Van #4102 · 48.3 kW", tone: "success" as StatusTone, status: "Charging" },
    { id: "DEPOT-A · CP-02", vehicle: "Van #4088 · 22.1 kW", tone: "success" as StatusTone, status: "Charging" },
    { id: "DEPOT-A · CP-03", vehicle: "V2G export · -19.4 kW", tone: "info" as StatusTone, status: "Discharging" },
    { id: "DEPOT-B · CP-07", vehicle: "Idle · plug free", tone: "neutral" as StatusTone, status: "Available" },
    { id: "DEPOT-B · CP-09", vehicle: "Fault · overtemp", tone: "danger" as StatusTone, status: "Faulted" },
  ],
};

const fmt = (n: number) => n.toFixed(1);

export const LiveSiteEnergy = () => {
  const styles = useStyles();
  const { data, series, status, lastUpdated } = useSiteEnergy(5000);

  const isLive = status === "live" && !!data;

  const buildingLoad = data?.buildingLoadKw ?? FALLBACK.buildingLoadKw;
  const evLoad = data?.evLoadKw ?? FALLBACK.evLoadKw;
  const gridLimit = data?.gridLimitKw ?? FALLBACK.gridLimitKw;
  const totalLoad = data?.totalLoadKw ?? buildingLoad + evLoad;
  const available = data?.availableKw ?? gridLimit - totalLoad;
  const utilization = data?.utilizationPct ?? Math.round((totalLoad / gridLimit) * 100);

  const connectors = data?.connectors
    ? data.connectors.map((c) => ({
        id: c.id,
        vehicle:
          c.status === "Available"
            ? c.vehicle
            : `${c.vehicle} · ${c.kw.toFixed(1)} kW`,
        tone: c.tone,
        status: c.status,
      }))
    : FALLBACK.connectors;

  const connStatus: { tone: StatusTone; label: string } =
    status === "live"
      ? { tone: "success", label: "Live · L8 API" }
      : status === "connecting"
      ? { tone: "warning", label: "Connecting…" }
      : { tone: "danger", label: "Offline · fallback data" };

  return (
    <div className={styles.root}>
      <PageHeader
        eyebrow={
          <>
            <StatusPill tone={connStatus.tone} label={connStatus.label} pulse={isLive} />
            L8 · Energy Manager
          </>
        }
        title="Live Site Energy"
        subtitle="Real-time dynamic load management across depots. Building and EV demand are balanced against the grid connection limit to keep the site within its firm capacity envelope."
        actions={
          <Tooltip
            content={
              lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString()}`
                : "Awaiting telemetry"
            }
            relationship="label"
          >
            <Button appearance="secondary" icon={<ArrowClockwise20Regular />}>
              {isLive ? "Auto-refreshing" : "Refresh"}
            </Button>
          </Tooltip>
        }
      />

      <div className={styles.kpiGrid}>
        <KpiCard
          index={0}
          label="Building Load"
          value={fmt(buildingLoad)}
          unit="kW"
          delta={-3}
          caption="vs last hour"
          accent="#38bdf8"
          icon={<Flash24Regular />}
        />
        <KpiCard
          index={1}
          label="Total EV Load"
          value={fmt(evLoad)}
          unit="kW"
          delta={12}
          caption="vs last hour"
          accent="#34d399"
          icon={<BatteryCharge24Regular />}
        />
        <KpiCard
          index={2}
          label="Available Capacity"
          value={fmt(available)}
          unit="kW"
          delta={-8}
          caption="headroom"
          accent="#a78bfa"
          icon={<ArrowTrendingLines24Regular />}
        />
        <KpiCard
          index={3}
          label="Grid Connection Limit"
          value={gridLimit.toString()}
          unit="kW"
          caption="firm capacity"
          accent="#fbbf24"
          icon={<Battery1024Regular />}
        />
      </div>

      <div className={styles.mainGrid}>
        <GlassCard
          title="Total Site Load vs. Limit"
          subtitle="Rolling window · 5s resolution"
          icon={<ArrowTrendingLines24Regular />}
          actions={<StatusPill tone={utilization > 90 ? "warning" : "success"} label={`${utilization}% utilised`} />}
        >
          <div className={styles.capacityBlock}>
            <div className={styles.capacityRow}>
              <Text className={styles.muted} size={200}>
                {fmt(totalLoad)} kW of {gridLimit} kW committed
              </Text>
              <span className={styles.capacityValue}>{utilization}%</span>
            </div>
            <ProgressBar
              value={Math.min(1, utilization / 100)}
              thickness="large"
              color={utilization > 90 ? "warning" : "success"}
            />
          </div>
          <EnergyChart totalLoad={totalLoad} limit={gridLimit} points={series} />
        </GlassCard>

        <GlassCard
          title="Connector Status"
          subtitle={`Depot A & B · ${connectors.length} shown`}
          icon={<PlugConnected24Regular />}
        >
          <div className={styles.connectorList}>
            {connectors.map((c) => (
              <div key={c.id} className={styles.connector}>
                <div className={styles.connectorMeta}>
                  <Text className={styles.connectorName} size={300}>
                    {c.id}
                  </Text>
                  <Text className={styles.muted} size={200}>
                    {c.vehicle}
                  </Text>
                </div>
                <StatusPill tone={c.tone} label={c.status} pulse={c.status === "Charging"} />
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
