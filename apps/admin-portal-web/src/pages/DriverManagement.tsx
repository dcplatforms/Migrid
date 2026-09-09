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
  People24Regular,
  Trophy24Regular,
  Wallet24Regular,
  Person20Regular,
  PersonAdd20Regular,
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
  mono: { fontVariantNumeric: "tabular-nums", color: tokens.colorNeutralForeground1 },
  muted: { color: tokens.colorNeutralForeground3 },
  headerCell: { color: tokens.colorNeutralForeground3 },
  search: { minWidth: "240px" },
  scrollX: {
    ...shorthands.overflow("auto", "hidden"),
    ...shorthands.padding("4px", "12px", "10px"),
  },
  rank: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    ...shorthands.borderRadius("999px"),
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    ...shorthands.border("1px", "solid", "rgba(255, 255, 255, 0.10)"),
    fontWeight: tokens.fontWeightBold,
    fontVariantNumeric: "tabular-nums",
  },
});

interface Driver {
  name: string;
  depot: string;
  score: number;
  tokens: string;
  tier: string;
  tierTone: StatusTone;
  status: string;
  statusTone: StatusTone;
}

const drivers: Driver[] = [
  { name: "Alice Nguyen", depot: "Depot A · San Jose", score: 982, tokens: "12,540 MGT", tier: "Platinum", tierTone: "info", status: "Active", statusTone: "success" },
  { name: "Marcus Reed", depot: "Depot A · San Jose", score: 934, tokens: "10,870 MGT", tier: "Platinum", tierTone: "info", status: "Active", statusTone: "success" },
  { name: "Priya Shah", depot: "Depot B · Fremont", score: 901, tokens: "9,220 MGT", tier: "Gold", tierTone: "warning", status: "Active", statusTone: "success" },
  { name: "Diego Alvarez", depot: "Depot B · Fremont", score: 845, tokens: "7,650 MGT", tier: "Gold", tierTone: "warning", status: "On Route", statusTone: "info" },
  { name: "Sara Kim", depot: "Depot C · Oakland", score: 788, tokens: "6,110 MGT", tier: "Silver", tierTone: "neutral", status: "Idle", statusTone: "neutral" },
  { name: "Tom Becker", depot: "Depot C · Oakland", score: 742, tokens: "5,430 MGT", tier: "Silver", tierTone: "neutral", status: "Active", statusTone: "success" },
];

export const DriverManagement = () => {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      <PageHeader
        eyebrow={<>L5 · Driver Experience + L6 · Engagement</>}
        title="Driver Management"
        subtitle="Grid-supportive driver behaviour is measured, scored and rewarded. Tokens are minted to driver wallets via the L10 Token Bridge for off-peak charging and verified V2G participation."
        actions={
          <>
            <Button appearance="secondary" icon={<Person20Regular />}>
              Import
            </Button>
            <Button appearance="primary" icon={<PersonAdd20Regular />}>
              Add Driver
            </Button>
          </>
        }
      />

      <div className={styles.kpiGrid}>
        <KpiCard index={0} label="Active Drivers" value="342" delta={4} caption="fleet-wide" accent="#38bdf8" icon={<People24Regular />} />
        <KpiCard index={1} label="Avg Engagement" value="86" unit="/100" delta={7} caption="behaviour score" accent="#34d399" icon={<Trophy24Regular />} />
        <KpiCard index={2} label="Tokens Minted (30d)" value="1.24M" unit="MGT" delta={19} caption="rewards" accent="#fbbf24" icon={<Wallet24Regular />} />
        <KpiCard index={3} label="V2G Participation" value="63" unit="%" delta={11} caption="opt-in rate" accent="#a78bfa" icon={<People24Regular />} />
      </div>

      <GlassCard
        title="Driver Leaderboard"
        subtitle="Ranked by engagement score"
        icon={<Trophy24Regular />}
        actions={<SearchBox className={styles.search} placeholder="Search drivers" appearance="filled-darker" />}
        flushBody
        bodyClassName={styles.scrollX}
      >
        <Table aria-label="Drivers" size="medium" style={{ minWidth: "760px" }}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell className={styles.headerCell}>#</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Driver</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Depot</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Score</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Tokens</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Tier</TableHeaderCell>
              <TableHeaderCell className={styles.headerCell}>Status</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drivers.map((d, i) => (
              <TableRow key={d.name}>
                <TableCell><span className={styles.rank}>{i + 1}</span></TableCell>
                <TableCell>
                  <TableCellLayout media={<Avatar name={d.name} color="colorful" size={32} />}>
                    {d.name}
                  </TableCellLayout>
                </TableCell>
                <TableCell><Text className={styles.muted} size={300}>{d.depot}</Text></TableCell>
                <TableCell><Text className={styles.mono} size={300}>{d.score}</Text></TableCell>
                <TableCell><Text className={styles.mono} size={300}>{d.tokens}</Text></TableCell>
                <TableCell><StatusPill tone={d.tierTone} label={d.tier} /></TableCell>
                <TableCell><StatusPill tone={d.statusTone} label={d.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </GlassCard>
    </div>
  );
};
