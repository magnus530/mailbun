import type { AddressDto } from "@mailclient/shared";
import { format, isToday, isYesterday, isThisYear } from "date-fns";

export function formatAddress(a: AddressDto): string {
  if (a.name) return `${a.name} <${a.address}>`;
  return a.address;
}

export function formatAddressShort(a: AddressDto): string {
  return a.name?.trim() || a.address;
}

export function formatRowDate(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Yesterday";
  if (isThisYear(d)) return format(d, "MMM d");
  return format(d, "MMM d, yyyy");
}

export function formatFullDate(iso: string): string {
  return format(new Date(iso), "EEE, MMM d yyyy 'at' HH:mm");
}

// Hard cap for inline previews (thread row, search results). The CSS
// `truncate` rule handles narrow viewports; this stops a long preview from
// dominating wide ones.
export function shortenPreview(s: string, max = 90): string {
  const cleaned = (s ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max).trimEnd() + "…";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function initials(a: AddressDto): string {
  const src = a.name || a.address;
  const parts = src.split(/[\s.@_-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b",
  "#10b981", "#14b8a6", "#6366f1", "#84cc16", "#f97316",
];
export function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}
