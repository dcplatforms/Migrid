import type { ReactNode } from "react";
import { makeStyles, shorthands, tokens, Text } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    columnGap: "16px",
    rowGap: "12px",
    flexWrap: "wrap",
  },
  left: {
    display: "flex",
    flexDirection: "column",
    rowGap: "6px",
    minWidth: 0,
  },
  eyebrow: {
    display: "flex",
    alignItems: "center",
    columnGap: "8px",
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    fontWeight: tokens.fontWeightSemibold,
  },
  title: {
    fontSize: "28px",
    lineHeight: "34px",
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
    ...shorthands.margin(0),
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
    maxWidth: "760px",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    columnGap: "10px",
  },
});

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export const PageHeader = ({ eyebrow, title, subtitle, actions }: PageHeaderProps) => {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      <div className={styles.left}>
        {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
        <h1 className={styles.title}>{title}</h1>
        {subtitle && (
          <Text size={300} className={styles.subtitle}>
            {subtitle}
          </Text>
        )}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
};
