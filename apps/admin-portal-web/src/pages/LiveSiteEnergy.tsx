import { makeStyles, shorthands, tokens, Text, ProgressBar, Button } from "@fluentui/react-components";
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
import { StatusPill } from "../components/StatusPill";

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
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    ...shorthands.border("1px", "solid", "rgba(255, 255, 255, 0.08)"),
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

const connectors = [
  { id: "DEPOT-A · CP-01", detail: "Van #4102 · 48.3 kW", tone: "success" as const, state: "Charging" },
  { id: "DEPOT-A · CP-02", detail: "Van #4088 · 22.1 kW", tone: "success" as const, state: "Charging" },
  { id: "DEPOT-A · CP-03", detail: "V2G export · -19.4 kW", tone: "info" as const, state: "Discharging" },
  { id: "DEPOT-B · CP-07", detail: "Idle · plug free", tone: "neutral" as const, state: "Available" },
  { id: "DEPOT-B · CP-09", detail: "Fault · overtemp", tone: "danger" as const, state: "Faulted" },
];

export const LiveSiteEnergy = () => {
  const styles = useStyles();

  const buildingLoad = 75.5;
  const evLoad = 120.3;
  const gridLimit = 250;
  const totalLoad = buildingLoad + evLoad;
  const available = gridLimit - totalLoad;
  const utilization = Math.round((totalLoad / gridLimit) * 100);

  return (
    <div className={styles.root}>
      <PageHeader
        eyebrow={
          <>
            <StatusPill tone="success" label="Live" pulse />
            L8 · Energy Manager
          </>
        }
        title="Live Site Energy"
        subtitle="Real-time dynamic load management across depots. Building and EV demand are balanced against the grid connection limit to keep the site within its firm capacity envelope."
        actions={
          <Button
            appearance="secondary"
            icon={<ArrowClockwise20Regular />}
          >
            Refresh
          </Button>
        }
      />

      <div className={styles.kpiGrid}>
        <KpiCard
          index={0}
          label="Building Load"
          value={buildingLoad.toFixed(1)}
          unit="kW"
          delta={-3}
          caption="vs last hour"
          accent="#38bdf8"
          icon={<Flash24Regular />}
        />
        <KpiCard
          index={1}
          label="Total EV Load"
          value={evLoad.toFixed(1)}
          unit="kW"
          delta={12}
          caption="vs last hour"
          accent="#34d399"
          icon={<BatteryCharge24Regular />}
        />
        <KpiCard
          index={2}
          label="Available Capacity"
          value={available.toFixed(1)}
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
          subtitle="Rolling 2-minute window · 5s resolution"
          icon={<ArrowTrendingLines24Regular />}
          actions={<StatusPill tone={utilization > 90 ? "warning" : "success"} label={`${utilization}% utilised`} />}
        >
          <div className={styles.capacityBlock}>
            <div className={styles.capacityRow}>
              <Text className={styles.muted} size={200}>
                {totalLoad.toFixed(1)} kW of {gridLimit} kW committed
              </Text>
              <span className={styles.capacityValue}>{utilization}%</span>
            </div>
            <ProgressBar
              value={utilization / 100}
              thickness="large"
              color={utilization > 90 ? "warning" : "success"}
            />
          </div>
          <EnergyChart totalLoad={totalLoad} limit={gridLimit} />
        </GlassCard>

        <GlassCard
          title="Connector Status"
          subtitle="Depot A & B · 5 of 24 shown"
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
                    {c.detail}
                  </Text>
                </div>
                <StatusPill tone={c.tone} label={c.state} pulse={c.state === "Charging"} />
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
