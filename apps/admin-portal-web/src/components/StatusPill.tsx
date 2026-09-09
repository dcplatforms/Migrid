import { makeStyles, shorthands, tokens, Text } from "@fluentui/react-components";
import { Circle12Filled } from "@fluentui/react-icons";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const toneColor: Record<StatusTone, string> = {
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#f87171",
  info: "#38bdf8",
  neutral: "#94a3b8",
};

const useStyles = makeStyles({
  root: {
    display: "inline-flex",
    alignItems: "center",
    columnGap: "6px",
    ...shorthands.padding("3px", "10px", "3px", "8px"),
    ...shorthands.borderRadius("999px"),
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    ...shorthands.border("1px", "solid", "rgba(255, 255, 255, 0.12)"),
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  label: {
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightMedium,
    lineHeight: "16px",
    whiteSpace: "nowrap",
  },
  pulse: {
    animationName: {
      "0%": { opacity: 0.4 },
      "50%": { opacity: 1 },
      "100%": { opacity: 0.4 },
    },
    animationDuration: "1.8s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
  },
});

interface StatusPillProps {
  tone?: StatusTone;
  label: string;
  pulse?: boolean;
}

export const StatusPill = ({ tone = "neutral", label, pulse }: StatusPillProps) => {
  const styles = useStyles();
  return (
    <span className={styles.root}>
      <Circle12Filled
        className={pulse ? styles.pulse : undefined}
        style={{ color: toneColor[tone] }}
      />
      <Text size={200} className={styles.label}>
        {label}
      </Text>
    </span>
  );
};
