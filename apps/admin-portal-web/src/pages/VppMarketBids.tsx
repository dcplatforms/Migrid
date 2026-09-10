import {
  makeStyles,
  shorthands,
  tokens,
  Text,
  Button,
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@fluentui/react-components";
import {
  ArrowTrendingLines24Regular,
  Money24Regular,
  Molecule24Regular,
  Flash20Filled,
  Add20Regular,
} from "@fluentui/react-icons";
import { GlassCard } from "../components/GlassCard";
import { KpiCard } from "../components/KpiCard";
import { PageHeader } from "../components/PageHeader";
import { StatusPill, type StatusTone } from "../components/StatusPill";
import { ConnectionPill } from "../components/ConnectionPill";
import { usePolling } from "../hooks/usePolling";
import { fetchMarket } from "../api/portal";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", rowGap: "22px" },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    ...shorthands.gap("18px"),
  },
  splitGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 1fr)",
    ...shorthands.gap("18px"),
  },
  mono: { fontVariantNumeric: "tabular-nums", color: tokens.colorNeutralForeground1 },
  muted: { color: tokens.colorNeutralForeground3 },
  headerCell: { color: tokens.colorNeutralForeground3 },
  scrollX: {
    ...shorthands.overflow("auto", "hidden"),
    ...shorthands.padding("4px", "12px", "10px"),
  },
  programList: { display: "flex", flexDirection: "column", rowGap: "12px" },
  program: {
    display: "flex",
    flexDirection: "column",
    rowGap: "8px",
    ...shorthands.padding("14px"),
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
    backgroundColor: "var(--surface-soft)",
    ...shorthands.border("1px", "solid", "var(--glass-subtle-border)"),
  },
  programTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  programName: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1 },
  bar: {
    height: "6px",
    ...shorthands.borderRadius("999px"),
    backgroundColor: "var(--hairline)",
    ...shorthands.overflow("hidden"),
  },
  barFill: { height: "100%", ...shorthands.borderRadius("999px") },
});

interface Bid {
  id: string;
  market: string;
  product: string;
  capacity: string;
  clearing: string;
  status: string;
  tone: StatusTone;
}

const FALLBACK_BIDS: Bid[] = [
  { id: "BID-5521", market: "CAISO", product: "Day-Ahead Energy", capacity: "1.2 MW", clearing: "$78.40/MWh", status: "Cleared", tone: "success" },
  { id: "BID-5519", market: "PJM", product: "Frequency Reg (RegD)", capacity: "0.8 MW", clearing: "$21.15/MW", status: "Cleared", tone: "success" },
  { id: "BID-5514", market: "ERCOT", product: "Responsive Reserve", capacity: "1.5 MW", clearing: "$44.90/MW", status: "Pending", tone: "warning" },
  { id: "BID-5510", market: "CAISO", product: "Real-Time Energy", capacity: "0.6 MW", clearing: "$112.30/MWh", status: "Cleared", tone: "success" },
  { id: "BID-5507", market: "Nord Pool", product: "mFRR", capacity: "0.9 MW", clearing: "€38.20/MW", status: "Rejected", tone: "danger" },
];

const programs = [
  { name: "CAISO · DRAM", value: 72, color: "#34d399" },
  { name: "PJM · Sync Reserve", value: 54, color: "#38bdf8" },
  { name: "ERCOT · ECRS", value: 38, color: "#a78bfa" },
];

export const VppMarketBids = () => {
  const styles = useStyles();
  const { data, status } = usePolling(fetchMarket, 5000);
  const summary = data?.summary;
  const bids: Bid[] = data?.bids ?? FALLBACK_BIDS;

  return (
    <div className={styles.root}>
      <PageHeader
        eyebrow={
          <>
            <ConnectionPill status={status} liveLabel="Live · L4 API" />
            L3 · VPP Aggregator + L4 · Market Gateway
          </>
        }
        title="VPP Market Bids"
        subtitle="Aggregated fleet capacity is bid into wholesale energy and ancillary-services markets. Arbitrage is driven by locational marginal price signals across CAISO, PJM, ERCOT and Nord Pool."
        actions={
          <Button appearance="primary" icon={<Add20Regular />}>
            New Bid
          </Button>
        }
      />

      <div className={styles.kpiGrid}>
        <KpiCard index={0} label="Dispatchable Capacity" value={(summary?.dispatchableMw ?? 4.9).toFixed(1)} unit="MW" delta={5} caption="fleet aggregate" accent="#34d399" icon={<Molecule24Regular />} />
        <KpiCard index={1} label="Revenue (30d)" value={`$${(summary?.revenue30dK ?? 182.4).toFixed(1)}k`} delta={14} caption="grid services" accent="#fbbf24" icon={<Money24Regular />} />
        <KpiCard index={2} label="Cleared Bids" value={(summary?.clearedBids ?? 63).toString()} delta={8} caption="this week" accent="#38bdf8" icon={<ArrowTrendingLines24Regular />} />
        <KpiCard index={3} label="Avg Clearing" value={`$${(summary?.avgClearingUsd ?? 74.1).toFixed(2)}`} unit="/MWh" delta={-3} caption="vs 30d avg" accent="#a78bfa" icon={<Flash20Filled />} />
      </div>

      <div className={styles.splitGrid}>
        <GlassCard title="Active & Recent Bids" subtitle="Wholesale market book" icon={<ArrowTrendingLines24Regular />} flushBody bodyClassName={styles.scrollX}>
          <Table aria-label="Market bids" size="medium" style={{ minWidth: "620px" }}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell className={styles.headerCell}>Bid</TableHeaderCell>
                <TableHeaderCell className={styles.headerCell}>Market</TableHeaderCell>
                <TableHeaderCell className={styles.headerCell}>Product</TableHeaderCell>
                <TableHeaderCell className={styles.headerCell}>Capacity</TableHeaderCell>
                <TableHeaderCell className={styles.headerCell}>Clearing</TableHeaderCell>
                <TableHeaderCell className={styles.headerCell}>Status</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bids.map((b) => (
                <TableRow key={b.id}>
                  <TableCell><Text className={styles.mono} size={300}>{b.id}</Text></TableCell>
                  <TableCell><Text size={300}>{b.market}</Text></TableCell>
                  <TableCell><Text className={styles.muted} size={300}>{b.product}</Text></TableCell>
                  <TableCell><Text className={styles.mono} size={300}>{b.capacity}</Text></TableCell>
                  <TableCell><Text className={styles.mono} size={300}>{b.clearing}</Text></TableCell>
                  <TableCell><StatusPill tone={b.tone} label={b.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </GlassCard>

        <GlassCard title="Program Enrolment" subtitle="Committed vs available capacity" icon={<Molecule24Regular />}>
          <div className={styles.programList}>
            {programs.map((p) => (
              <div key={p.name} className={styles.program}>
                <div className={styles.programTop}>
                  <Text className={styles.programName} size={300}>{p.name}</Text>
                  <Text className={styles.mono} size={300}>{p.value}%</Text>
                </div>
                <div className={styles.bar}>
                  <div
                    className={styles.barFill}
                    style={{ width: `${p.value}%`, backgroundColor: p.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
