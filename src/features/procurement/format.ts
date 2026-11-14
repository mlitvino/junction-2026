import type { ProvisionalMoney } from "@/client/provisional/types";

// Display only: no product totals, VAT, policy or unit conversion is calculated here.
export function money(value: ProvisionalMoney | null | undefined) {
  if (!value) return "Price unavailable";
  const padded = value.amountMinor.padStart(3, "0");
  const whole = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `€${whole}.${padded.slice(-2)}`;
}
export function date(value: string | null | undefined) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Helsinki",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
}
export function timestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Helsinki",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
