import { makeStyles, shorthands, tokens } from "@fluentui/react-components";

/**
 * Shared Acrylic / "frosted glass" surface styles built on top of Fluent UI v9.
 *
 * Fluent's Acrylic material is a translucent surface that samples and blurs
 * whatever sits behind it. We emulate it with a semi-transparent fill plus a
 * `backdrop-filter` blur+saturate, a hairline highlight border, and a soft
 * elevation shadow so panels read as layered glass on the energy backdrop.
 */
export const useGlassStyles = makeStyles({
  // Primary content surface (cards, panels).
  panel: {
    position: "relative",
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    backdropFilter: "blur(26px) saturate(165%)",
    WebkitBackdropFilter: "blur(26px) saturate(165%)",
    ...shorthands.border("1px", "solid", "rgba(255, 255, 255, 0.12)"),
    ...shorthands.borderRadius(tokens.borderRadiusXLarge),
    boxShadow:
      "0 10px 34px rgba(2, 6, 16, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.10)",
  },
  // A lighter surface for nested elements / rows.
  panelSubtle: {
    backgroundColor: "rgba(255, 255, 255, 0.035)",
    backdropFilter: "blur(14px) saturate(140%)",
    WebkitBackdropFilter: "blur(14px) saturate(140%)",
    ...shorthands.border("1px", "solid", "rgba(255, 255, 255, 0.08)"),
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
  },
  // Heavier chrome for the app header / rails.
  chrome: {
    backgroundColor: "rgba(9, 13, 22, 0.55)",
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
      backgroundColor: "rgba(255, 255, 255, 0.09)",
      ...shorthands.borderColor("rgba(255, 255, 255, 0.20)"),
      transform: "translateY(-2px)",
      boxShadow:
        "0 16px 40px rgba(2, 6, 16, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.14)",
    },
  },
});

/** Accent gradient used for the brand mark and key highlights. */
export const brandGradient =
  "linear-gradient(135deg, #34d399 0%, #22d3ee 55%, #818cf8 100%)";
