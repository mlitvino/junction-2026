import type { ComponentProps } from "react";

const paths = {
  workspace: "M3 4h18v14H7l-4 3V4Z",
  approvals: "M14 3H4v18h16V9 M14 3v6h6l-6-6Z M7 11h3 M7 15h3 M12 15l2 2 4-4",
  restocking: "M4 4h16v4H4V4Z M5 8v13h14V8 M10 12h4",
  recipes:
    "M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1v15 M5 8h4 M5 11h4 M15 8h4 M15 11h4",
  orders: "M5 4h14v18H5V4Z M8 2v4 M12 2v4 M16 2v4 M8 10h8 M8 14h8 M8 18h5",
  agents: "M8 5h8l4 4v9H4V9l4-4Z M9 12h.01 M15 12h.01 M9 16h6 M12 2v3",
  settings:
    "m9.6 4.8.6-2.8h3.6l.6 2.8 2.4 1.4 2.7-.9 1.8 3.1-2.1 1.9v2.8l2.1 1.9-1.8 3.1-2.7-.9-2.4 1.4-.6 2.8h-3.6l-.6-2.8-2.4-1.4-2.7.9-1.8-3.1 2.1-1.9v-2.8L2.7 8.4l1.8-3.1 2.7.9 2.4-1.4Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  sliders: "M3 6h18 M8 3v6 M3 12h18 M16 9v6 M3 18h18 M11 15v6",
  "shield-outline": "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z",
  "log-out": "M9 4H4v16h5 M14 8l4 4-4 4 M8 12h10",
  audit: "M5 3h10l4 4v14H5V3Z M14 3v5h5 M9 12h6 M9 16h6",
  integrations: "M8 3v5 M16 3v5 M6 8h12v3a6 6 0 0 1-6 6v4 M12 17a6 6 0 0 1-6-6",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5l1.5 1.5 M5 19l1.5-1.5 M17.5 6.5l1.5-1.5",
  moon: "M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z",
  monitor: "M3 4h18v13H3V4Z M8 21h8 M12 17v4",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  close: "m6 6 12 12 M6 18 18 6",
  arrow: "M12 19V5 M6 11l6-6 6 6",
  "arrow-left": "M19 12H5 M11 6l-6 6 6 6",
  "arrow-right": "M5 12h14 M13 6l6 6-6 6",
  check: "m5 12 4 4L19 6",
  "check-circle": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M8 12l3 3 5-6",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2",
  truck:
    "M3 5h11v12H3V5Z M14 9h4l3 4v4h-7 M7 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4 M17 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
  compare: "M4 7h14 M14 3l4 4-4 4 M20 17H6 M10 13l-4 4 4 4",
  lock: "M5 10h14v11H5V10Z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3",
  chevron: "m9 5 7 7-7 7",
  leaf: "M20 3c-9-1-16 3-16 10a6 6 0 0 0 6 6c7 0 11-7 10-16Z M4 21 15 10",
  search: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 m-2 5 6 6",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z m-4 9 3 3 5-6",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7h.01",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: ComponentProps<"svg"> & { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
