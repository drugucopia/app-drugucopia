import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Calculator,
  FlaskConical,
  History,
  Leaf,
  PlusCircle,
  Shield,
  Shuffle,
  Pill,
  Settings,
} from "lucide-react";

export interface NavItem {
  id:
    | "library"
    | "interactions"
    | "track"
    | "analytics"
    | "calculators"
    | "custom-substances"
    | "safety"
    | "changelog"
    | "medications"
    | "settings";
  href: string;
  label: string;
  icon: LucideIcon;
  section: "explore" | "track" | "tools" | "info";
  /**
   * DaisyUI semantic color token used for the item's icon. Inactive items
   * render the icon at ~70% opacity in this color; active items render at
   * full opacity. This gives each section a stable theme-aware accent so
   * the sidebar reads as more colorful instead of monochrome neutral.
   */
  color:
    | "primary"
    | "secondary"
    | "accent"
    | "info"
    | "success"
    | "warning"
    | "error";
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: "library",
    href: "/",
    label: "Library",
    icon: FlaskConical,
    section: "explore",
    color: "primary",
  },
  {
    id: "interactions",
    href: "/interactions",
    label: "Interactions",
    icon: Shuffle,
    section: "explore",
    color: "secondary",
  },
  {
    id: "track",
    href: "/dose-log",
    label: "Track",
    icon: Activity,
    section: "track",
    color: "accent",
  },
  {
    id: "analytics",
    href: "/analytics",
    label: "Analytics",
    icon: BarChart3,
    section: "tools",
    color: "info",
  },
  {
    id: "calculators",
    href: "/calculators",
    label: "Calculators",
    icon: Calculator,
    section: "tools",
    color: "warning",
  },
  {
    id: "custom-substances",
    href: "/custom-substances",
    label: "Custom Substances",
    icon: PlusCircle,
    section: "explore",
    color: "success",
  },
  {
    id: "medications",
    href: "/medications",
    label: "Medications",
    icon: Pill,
    section: "track",
    color: "info",
  },
  {
    id: "safety",
    href: "/harm-reduction",
    label: "Safety",
    icon: Shield,
    section: "explore",
    color: "error",
  },
  {
    id: "changelog",
    href: "/changelog",
    label: "Changelog",
    icon: History,
    section: "info",
    color: "info",
  },
  {
    id: "settings",
    href: "/settings",
    label: "Settings",
    icon: Settings,
    section: "info",
    color: "success",
  },
];

export const NAV_SECTIONS: Array<{
  title: string;
  section: NavItem["section"];
}> = [
  { title: "Explore", section: "explore" },
  { title: "Track", section: "track" },
  { title: "Tools", section: "tools" },
  { title: "Info", section: "info" },
];

export function isNavItemActive(item: NavItem, pathname: string) {
  // Normalize trailing slash: with `trailingSlash: true` in next.config.ts,
  // `/dose-log` becomes `/dose-log/`. Strip it so comparisons work either way.
  const p = pathname.replace(/\/$/, "") || "/";
  switch (item.id) {
    case "library":
      // Library is active on bare `/` (no trailing path, no view param).
      return p === "/";
    case "track":
      return p.startsWith("/dose-log");
    case "interactions":
      return p.startsWith("/interactions");
    case "analytics":
      return p.startsWith("/analytics");
    case "calculators":
      return p.startsWith("/calculators");
    case "custom-substances":
      return p.startsWith("/custom-substances");
    case "medications":
      return p.startsWith("/medications");
    case "safety":
      return p.startsWith("/harm-reduction");
    case "changelog":
      return p.startsWith("/changelog");
    case "settings":
      return p.startsWith("/settings");
    default:
      return false;
  }
}

export function getPageTitle(pathname: string) {
  // Normalize trailing slash (see isNavItemActive for rationale).
  const p = pathname.replace(/\/$/, "") || "/";
  switch (p) {
    case "/":
      return "Library";
    case "/interactions":
      return "Interactions";
    case "/dose-log":
      return "Track";
    case "/analytics":
      return "Analytics";
    case "/calculators":
      return "Calculators";
    case "/custom-substances":
      return "Custom Substances";
    case "/medications":
      return "Medications";
    case "/calculators/benzo-equivalence":
      return "Benzo Equivalence";
    case "/calculators/dxm":
      return "DXM Calculator";
    case "/calculators/kratom":
      return "Kratom Calculator";
    case "/calculators/alcohol":
      return "Alcohol Calculator";
    case "/harm-reduction":
      return "Safety";
    case "/changelog":
      return "Changelog";
    default:
      return "Drugucopia";
  }
}
