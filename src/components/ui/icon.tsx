import type { ComponentProps } from "react";

const paths = {
  workspace: "M4 5h16v11H9l-5 4V5Z M8 9h8 M8 12h5",
  approvals: "M9 5H5v16h14V5h-4 M9 3h6v4H9V3Z M8 14l3 3 5-6",
  orders: "m3 7 9-4 9 4v11l-9 4-9-4V7Z m0 0 9 4 9-4 M12 11v11 M7 5l10 4",
  agents: "M8 5h8l4 4v9H4V9l4-4Z M9 12h.01 M15 12h.01 M9 16h6 M12 2v3",
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
