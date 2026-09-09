import {
  makeStyles,
  shorthands,
  tokens,
  Text,
  Button,
  Avatar,
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  TableCellLayout,
  SearchBox,
} from "@fluentui/react-components";
import {
  PlugConnected24Regular,
  Filter20Regular,
  ArrowDownload20Regular,
  Flash20Filled,
  Checkmark20Regular,
} from "@fluentui/react-icons";
import { GlassCard } from "../components/GlassCard";
import { KpiCard } from "../components/KpiCard";
import { PageHeader } from "../components/PageHeader";
import { StatusPill, type StatusTone } from "../components/StatusPill";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", rowGap: "22px" },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    ...shorthands.gap("18px"),
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    columnGap: "10px",
    flexWrap: "wrap",
  },
  search: { minWidth: "240px" },
  mono: { fontVariantNumeric: "tabular-nums", color: tokens.colorNeutralForeground1 },
  muted: { color: tokens.colorNeutralForeground3 },
  scrollX: {
    ...shorthands.overflow("auto", "hidden"),
    ...shorthands.padding("4px", "12px", "10px"),
  },
  row: {
    ":hover": { backgroundColor: "var(--row-hover)" },
  },
  headerCell: { color: tokens.colorNeutralForeground3 },
});

interface Session {
  id: string;
  driver: string;
  vehicle: string;
  energy: string;
  variance: string;
  varianceTone: StatusTone;
  status: string;
  statusTone: StatusTone;
}

const sessions: Session[] = [
  { id: "SES-90241", driver: "Alice Nguyen", vehicle: "Ford E-Transit #4102", energy: "48.32 kWh", variance: "2.1%", varianceTone: "success", status: "Verified", statusTone: "success" },
  { id: "SES-90238", driver: "Marcus Reed", vehicle: "Rivian EDV #3391", energy: "61.07 kWh", variance: "4.8%", varianceTone: "success", status: "Verified", statusTone: "success" },
  { id: "SES-90233", driver: "Priya Shah", vehicle: "BrightDrop Zevo #2210", energy: "33.55 kWh", variance: "11.4%", varianceTone: "warning", status: "Review", statusTone: "warning" },
  { id: "SES-90229", driver: "Diego Alvarez", vehicle: "Ford E-Transit #4088", energy: "52.90 kWh", variance: "1.2%", varianceTone: "success", status: "Verified", statusTone: "success" },
  { id: "SES-90224", driver: "Sara Kim", vehicle: "Rivian EDV #3377", energy: "18.02 kWh", variance: "17.9%", varianceTone: "danger", status: "Flagged", statusTone: "danger" },
  { id: "SES-90218", driver: "Tom Becker", vehicle: "BrightDrop Zevo #2188", energy: "44.71 kWh", variance: "3.3%", varianceTone: "success", status: "Verified", statusTone: "success" },
  { id: "SES-90212", driver: "Lena Osei", vehicle: "Ford E-Transit #4110", energy: "-19.40 kWh", variance: "0.9%", varianceTone: "info", status: "V2G Export", statusTone: "info" },
];

export const ChargingSessions = () => {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      <PageHeader
        eyebrow={<>L1 · Physics Engine</>}
        title="Charging Sessions"
        subtitle="Every session is audited by the Physics Engine — energy dispensed is reconciled against energy received with a strict <15% variance threshold before settlement."
        actions={
          <>
            <Button appearance="secondary" icon={<Filter20Regular />}>
              Filter
            </Button>
            <Button appearance="primary" icon={<ArrowDownload20Regular />}>
              Export
            </Button>
          </>
        }
      />

      <div className={styles.kpiGrid}>
        <KpiCard index={0} label="Sessions Today" value="1,284" delta={9} caption="vs yesterday" accent="#38bdf8" icon={<PlugConnected24Regular />} />
        <KpiCard index={1} label="Energy Dispensed" value="42.7" unit="MWh" delta={6} caption="vs yesterday" accent="#34d399" icon={<Flash20Filled />} />
        <KpiCard index={2} label="Physics Pass Rate" value="97.4" unit="%" delta={1} caption="verified" accent="#a78bfa" icon={<Checkmark20Regular />} />
        <KpiCard index={3} label="Flagged Sessions" value="14" delta={-22} caption="needs review" accent="#f87171" icon={<Filter20Regular />} />
      </div>

      <GlassCard
        title="Recent Sessions"
        subtitle="Live audit feed"
        icon={<PlugConnected24Regular />}
        actions={
          <div className={styles.toolbar}>
            <SearchBox className={styles.search} placeholder="Search sessions, drivers, vehicles" appearance="filled-darker" />
          </div>
        }
        flushBody
        bodyClassName={styles.scrollX}
      >
        <Table aria-label="Charging sessions" size="medium" style={{ minWidth: "760px" }}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell className={styles.headerCell}>Session</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Driver</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Vehicle</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Energy</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Variance</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Status</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id} className={styles.row}>
                <TableCell>
                  <Text className={styles.mono} size={300}>{s.id}</Text>
                </TableCell>
                <TableCell>
                  <TableCellLayout
                    media={<Avatar name={s.driver} color="colorful" size={28} />}
                  >
                    {s.driver}
                  </TableCellLayout>
                </TableCell>
                <TableCell>
                  <Text className={styles.muted} size={300}>{s.vehicle}</Text>
                </TableCell>
                <TableCell>
                  <Text className={styles.mono} size={300}>{s.energy}</Text>
                </TableCell>
                <TableCell>
                  <StatusPill tone={s.varianceTone} label={s.variance} />
                </TableCell>
                <TableCell>
                  <StatusPill tone={s.statusTone} label={s.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </GlassCard>
    </div>
  );
};
