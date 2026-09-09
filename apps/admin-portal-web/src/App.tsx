import { useState, type ReactNode } from "react";
import {
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
  Text,
  Avatar,
  Button,
  Tooltip,
  Badge,
} from "@fluentui/react-components";
import {
  Flash24Filled,
  ChartMultiple24Regular,
  PlugConnected24Regular,
  Molecule24Regular,
  People24Regular,
  Search24Regular,
  Alert24Regular,
  Settings24Regular,
} from "@fluentui/react-icons";
import { useGlassStyles, brandGradient } from "./theme/glass";
import { StatusPill } from "./components/StatusPill";
import { LiveSiteEnergy } from "./pages/LiveSiteEnergy";
import { ChargingSessions } from "./pages/ChargingSessions";
import { VppMarketBids } from "./pages/VppMarketBids";
import { DriverManagement } from "./pages/DriverManagement";

const useStyles = makeStyles({
  root: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    ...shorthands.overflow("hidden"),
    color: tokens.colorNeutralForeground1,
  },
  header: {
    display: "flex",
    alignItems: "center",
    columnGap: "16px",
    height: "60px",
    flexShrink: 0,
    ...shorthands.padding("0px", "20px"),
    ...shorthands.borderBottom("1px", "solid", "rgba(255, 255, 255, 0.08)"),
    zIndex: 3,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    columnGap: "12px",
    minWidth: "220px",
  },
  brandMark: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "36px",
    height: "36px",
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
    backgroundImage: brandGradient,
    color: "#04120c",
    boxShadow: "0 6px 18px rgba(52, 211, 153, 0.35)",
  },
  brandText: { display: "flex", flexDirection: "column", lineHeight: "1.1" },
  brandName: {
    fontWeight: tokens.fontWeightBold,
    fontSize: "16px",
    letterSpacing: "0.02em",
  },
  brandSub: {
    color: tokens.colorNeutralForeground3,
    fontSize: "11px",
    letterSpacing: "0.16em",
    textTransform: "uppercase",
  },
  headerCenter: {
    flexGrow: 1,
    display: "flex",
    justifyContent: "center",
  },
  searchStub: {
    display: "flex",
    alignItems: "center",
    columnGap: "10px",
    width: "min(420px, 40vw)",
    ...shorthands.padding("7px", "14px"),
    ...shorthands.borderRadius("999px"),
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    ...shorthands.border("1px", "solid", "rgba(255, 255, 255, 0.10)"),
    color: tokens.colorNeutralForeground3,
    cursor: "text",
  },
  headerRight: { display: "flex", alignItems: "center", columnGap: "10px" },
  iconButton: { color: tokens.colorNeutralForeground2 },
  body: { display: "flex", flexGrow: 1, minHeight: 0 },
  sidebar: {
    width: "236px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    rowGap: "18px",
    ...shorthands.padding("18px", "14px"),
    ...shorthands.borderRight("1px", "solid", "rgba(255, 255, 255, 0.08)"),
    zIndex: 2,
  },
  navGroupLabel: {
    color: tokens.colorNeutralForeground4,
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    fontSize: "10px",
    fontWeight: tokens.fontWeightSemibold,
    ...shorthands.padding("0px", "10px"),
    marginBottom: "6px",
  },
  nav: { display: "flex", flexDirection: "column", rowGap: "4px" },
  navItem: {
    display: "flex",
    alignItems: "center",
    columnGap: "12px",
    ...shorthands.padding("10px", "12px"),
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
    ...shorthands.border("1px", "solid", "transparent"),
    color: tokens.colorNeutralForeground2,
    cursor: "pointer",
    transitionProperty: "background-color, color, border-color",
    transitionDuration: tokens.durationFast,
    ":hover": {
      backgroundColor: "rgba(255, 255, 255, 0.06)",
      color: tokens.colorNeutralForeground1,
    },
  },
  navItemActive: {
    backgroundColor: "rgba(255, 255, 255, 0.09)",
    ...shorthands.borderColor("rgba(255, 255, 255, 0.14)"),
    color: tokens.colorNeutralForeground1,
    boxShadow: "inset 3px 0 0 0 #34d399",
  },
  navIcon: { display: "inline-flex", flexShrink: 0 },
  navLabel: { fontWeight: tokens.fontWeightMedium, flexGrow: 1 },
  sidebarFooter: { marginTop: "auto" },
  siteCard: {
    display: "flex",
    flexDirection: "column",
    rowGap: "8px",
    ...shorthands.padding("14px"),
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
  },
  siteRow: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  content: {
    flexGrow: 1,
    minWidth: 0,
    ...shorthands.overflow("auto"),
    ...shorthands.padding("28px", "32px", "40px"),
  },
  contentInner: { maxWidth: "1360px", ...shorthands.margin("0", "auto") },
  statusBar: {
    display: "flex",
    alignItems: "center",
    columnGap: "16px",
    height: "30px",
    flexShrink: 0,
    ...shorthands.padding("0px", "20px"),
    ...shorthands.borderTop("1px", "solid", "rgba(255, 255, 255, 0.08)"),
    color: tokens.colorNeutralForeground3,
    fontSize: "12px",
  },
  spacer: { flexGrow: 1 },
});

type PageKey = "energy" | "sessions" | "vpp" | "drivers";

const nav: { key: PageKey; label: string; icon: ReactNode; layer: string }[] = [
  { key: "energy", label: "Live Site Energy", icon: <ChartMultiple24Regular />, layer: "L8" },
  { key: "sessions", label: "Charging Sessions", icon: <PlugConnected24Regular />, layer: "L1" },
  { key: "vpp", label: "VPP Market Bids", icon: <Molecule24Regular />, layer: "L3" },
  { key: "drivers", label: "Driver Management", icon: <People24Regular />, layer: "L5" },
];

function App() {
  const styles = useStyles();
  const glass = useGlassStyles();
  const [page, setPage] = useState<PageKey>("energy");

  return (
    <div className={styles.root}>
      <header className={mergeClasses(glass.chrome, styles.header)}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>
            <Flash24Filled />
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>MiGrid</span>
            <span className={styles.brandSub}>Fleet Portal</span>
          </span>
        </div>
        <div className={styles.headerCenter}>
          <div className={styles.searchStub}>
            <Search24Regular />
            <Text size={300}>Search sites, vehicles, drivers, sessions…</Text>
          </div>
        </div>
        <div className={styles.headerRight}>
          <StatusPill tone="success" label="All Systems Operational" pulse />
          <Tooltip content="Alerts" relationship="label">
            <Button appearance="subtle" className={styles.iconButton} icon={<Alert24Regular />} shape="circular" />
          </Tooltip>
          <Tooltip content="Settings" relationship="label">
            <Button appearance="subtle" className={styles.iconButton} icon={<Settings24Regular />} shape="circular" />
          </Tooltip>
          <Avatar name="Jordan Field" color="colorful" size={32} badge={{ status: "available" }} />
        </div>
      </header>

      <div className={styles.body}>
        <nav className={mergeClasses(glass.chrome, styles.sidebar)}>
          <div>
            <div className={styles.navGroupLabel}>Operations</div>
            <div className={styles.nav}>
              {nav.map((item) => {
                const active = page === item.key;
                return (
                  <div
                    key={item.key}
                    className={mergeClasses(
                      styles.navItem,
                      active && styles.navItemActive
                    )}
                    onClick={() => setPage(item.key)}
                    role="tab"
                    aria-selected={active}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setPage(item.key);
                    }}
                  >
                    <span className={styles.navIcon}>{item.icon}</span>
                    <span className={styles.navLabel}>{item.label}</span>
                    <Badge appearance="tint" color="informative" size="small">
                      {item.layer}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={styles.sidebarFooter}>
            <div className={mergeClasses(glass.panelSubtle, styles.siteCard)}>
              <div className={styles.siteRow}>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  Active Site
                </Text>
                <StatusPill tone="success" label="Online" />
              </div>
              <Text weight="semibold" size={300}>
                San Jose Fleet Hub
              </Text>
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                24 connectors · 4.9 MW VPP
              </Text>
            </div>
          </div>
        </nav>

        <main className={styles.content}>
          <div className={styles.contentInner}>
            {page === "energy" && <LiveSiteEnergy />}
            {page === "sessions" && <ChargingSessions />}
            {page === "vpp" && <VppMarketBids />}
            {page === "drivers" && <DriverManagement />}
          </div>
        </main>
      </div>

      <footer className={mergeClasses(glass.chrome, styles.statusBar)}>
        <StatusPill tone="success" label="Grid Sync 512ms" />
        <Text size={200}>OpenADR 3.0 · connected</Text>
        <Text size={200}>OCPP 2.1 · 24 stations</Text>
        <span className={styles.spacer} />
        <Text size={200}>MiGrid Core v10.1.6</Text>
        <Text size={200}>© 2026 MiGrid</Text>
      </footer>
    </div>
  );
}

export default App;
