import type { ReactNode } from "react";
import { makeStyles, mergeClasses, shorthands, tokens, Text } from "@fluentui/react-components";
import { ArrowUp12Filled, ArrowDown12Filled } from "@fluentui/react-icons";
import { useGlassStyles } from "../theme/glass";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    rowGap: "14px",
    ...shorthands.padding("18px", "20px"),
    minHeight: "132px",
    animationName: "migrid-fade-in",
    animationDuration: tokens.durationSlow,
    animationFillMode: "both",
  },
  topRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    fontWeight: tokens.fontWeightSemibold,
  },
  iconWrap: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "36px",
    height: "36px",
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    ...shorthands.border("1px", "solid", "rgba(255, 255, 255, 0.10)"),
    color: tokens.colorNeutralForeground1,
  },
  valueRow: {
    display: "flex",
    alignItems: "baseline",
    columnGap: "6px",
  },
  value: {
    fontSize: "32px",
    lineHeight: "36px",
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
    fontVariantNumeric: "tabular-nums",
  },
  unit: {
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightMedium,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    columnGap: "8px",
  },
  delta: {
    display: "inline-flex",
    alignItems: "center",
    columnGap: "2px",
    ...shorthands.padding("2px", "7px"),
    ...shorthands.borderRadius("999px"),
    fontWeight: tokens.fontWeightSemibold,
  },
  deltaUp: {
    color: "#34d399",
    backgroundColor: "rgba(52, 211, 153, 0.14)",
  },
  deltaDown: {
    color: "#f87171",
    backgroundColor: "rgba(248, 113, 113, 0.14)",
  },
  caption: {
    color: tokens.colorNeutralForeground3,
  },
  accentBar: {
    position: "absolute",
    left: 0,
    top: "16px",
    bottom: "16px",
    width: "3px",
    ...shorthands.borderRadius("999px"),
  },
});

interface KpiCardProps {
  label: string;
  value: string;
  unit?: string;
  icon: ReactNode;
  delta?: number;
  caption?: string;
  accent?: string;
  index?: number;
}

export const KpiCard = ({
  label,
  value,
  unit,
  icon,
  delta,
  caption,
  accent = "#34d399",
  index = 0,
}: KpiCardProps) => {
  const styles = useStyles();
  const glass = useGlassStyles();
  const up = (delta ?? 0) >= 0;

  return (
    <div
      className={mergeClasses(glass.panel, glass.interactive, styles.root)}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <span className={styles.accentBar} style={{ backgroundColor: accent }} />
      <div className={styles.topRow}>
        <Text size={200} className={styles.label}>
          {label}
        </Text>
        <span className={styles.iconWrap} style={{ color: accent }}>
          {icon}
        </span>
      </div>
      <div className={styles.valueRow}>
        <span className={styles.value}>{value}</span>
        {unit && <span className={styles.unit}>{unit}</span>}
      </div>
      <div className={styles.footer}>
        {typeof delta === "number" && (
          <span
            className={mergeClasses(
              styles.delta,
              up ? styles.deltaUp : styles.deltaDown
            )}
          >
            {up ? <ArrowUp12Filled /> : <ArrowDown12Filled />}
            {Math.abs(delta)}%
          </span>
        )}
        {caption && (
          <Text size={200} className={styles.caption}>
            {caption}
          </Text>
        )}
      </div>
    </div>
  );
};
