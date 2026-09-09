import { makeStyles, shorthands, tokens } from "@fluentui/react-components";

/**
 * Shared Acrylic / "frosted glass" surface styles built on top of Fluent UI v9.
 *
 * Fluent's Acrylic material is a translucent surface that samples and blurs
 * whatever sits behind it. We emulate it with a semi-transparent fill plus a
 * `backdrop-filter` blur+saturate, a hairline highlight border, and a soft
 * elevation shadow so panels read as layered glass on the energy backdrop.
 *
 * All tints reference CSS variables (defined per theme in index.css) so the
 * same panels adapt to the light/dark toggle.
 */
export const useGlassStyles = makeStyles({
  // Primary content surface (cards, panels).
  panel: {
    position: "relative",
    backgroundColor: "var(--glass-bg)",
    backdropFilter: "blur(26px) saturate(165%)",
    WebkitBackdropFilter: "blur(26px) saturate(165%)",
    ...shorthands.border("1px", "solid", "var(--glass-border)"),
    ...shorthands.borderRadius(tokens.borderRadiusXLarge),
    boxShadow: "var(--glass-shadow), inset 0 1px 0 var(--glass-hi)",
  },
  // A lighter surface for nested elements / rows.
  panelSubtle: {
    backgroundColor: "var(--glass-subtle-bg)",
    backdropFilter: "blur(14px) saturate(140%)",
    WebkitBackdropFilter: "blur(14px) saturate(140%)",
    ...shorthands.border("1px", "solid", "var(--glass-subtle-border)"),
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
  },
  // Heavier chrome for the app header / rails.
  chrome: {
    backgroundColor: "var(--glass-chrome-bg)",
    backdropFilter: "blur(30px) saturate(180%)",
    WebkitBackdropFilter: "blur(30px) saturate(180%)",
  },
  // Interactive hover affordance for glass elements.
  interactive: {
    transitionProperty: "transform, box-shadow, background-color, border-color",
    transitionDuration: tokens.durationNormal,
    transitionTimingFunction: tokens.curveEasyEase,
    cursor: "pointer",
    ":hover": {
      backgroundColor: "var(--glass-bg-hover)",
      ...shorthands.borderColor("var(--glass-border-hover)"),
      transform: "translateY(-2px)",
      boxShadow: "var(--glass-shadow-hover), inset 0 1px 0 var(--glass-hi-strong)",
    },
  },
});

/** Accent gradient used for the brand mark and key highlights. */
export const brandGradient =
  "linear-gradient(135deg, #34d399 0%, #22d3ee 55%, #818cf8 100%)";
