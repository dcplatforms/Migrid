import type { ReactNode } from "react";
import { makeStyles, mergeClasses, shorthands, tokens, Text } from "@fluentui/react-components";
import { useGlassStyles } from "../theme/glass";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    ...shorthands.overflow("hidden"),
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: "12px",
    ...shorthands.padding("16px", "20px"),
    ...shorthands.borderBottom("1px", "solid", "var(--hairline)"),
  },
  headerText: {
    display: "flex",
    flexDirection: "column",
    rowGap: "2px",
    minWidth: 0,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    columnGap: "10px",
  },
  icon: {
    display: "inline-flex",
    color: tokens.colorNeutralForeground2,
  },
  title: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    columnGap: "8px",
    flexShrink: 0,
  },
  body: {
    ...shorthands.padding("20px"),
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minWidth: 0,
  },
  flush: {
    ...shorthands.padding("0px"),
  },
});

interface GlassCardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  flushBody?: boolean;
}

export const GlassCard = ({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  flushBody,
}: GlassCardProps) => {
  const styles = useStyles();
  const glass = useGlassStyles();
  const hasHeader = title || subtitle || actions || icon;

  return (
    <section className={mergeClasses(glass.panel, styles.root, className)}>
      {hasHeader && (
        <header className={styles.header}>
          <div className={styles.headerText}>
            <div className={styles.titleRow}>
              {icon && <span className={styles.icon}>{icon}</span>}
              {title && <Text className={styles.title}>{title}</Text>}
            </div>
            {subtitle && (
              <Text size={200} className={styles.subtitle}>
                {subtitle}
              </Text>
            )}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div
        className={mergeClasses(
          styles.body,
          flushBody && styles.flush,
          bodyClassName
        )}
      >
        {children}
      </div>
    </section>
  );
};
