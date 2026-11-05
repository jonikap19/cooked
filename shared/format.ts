import type { Recipe } from "./schema";

export function scaleAmount(amount: number | null, base: number, target: number): number | null {
  return amount === null ? null : (amount * target) / base;
}

export function formatAmount(amount: number | null): string {
  if (amount === null) return "";
  const rounded = Math.round(amount * 100) / 100;
  // A tiny scaled-down amount keeps one significant digit instead of reading "0".
  return String(rounded === 0 && amount !== 0 ? Number(amount.toPrecision(1)) : rounded).replace(".", ",");
}

export function detectPlatform(url: string | null): Recipe["source_platform"] {
  if (!url) return null;
  const host = URL.canParse(url) ? new URL(url).hostname : "";
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)youtube\.com$/.test(host) || host === "youtu.be") return "youtube";
  return "web";
}

export function countLabel(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function formatQuantity(amount: number | null, unit: string): string {
  return [formatAmount(amount), unit].filter(Boolean).join(" ");
}

const shortDate = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", timeZone: "Europe/Berlin" });

export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : shortDate.format(date);
}

export function initials(email: string): string {
  const parts = email.split("@")[0].split(/[._-]/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
}

/** Heading above a comment: who wrote it, on group recipes only (a personal recipe's comments are all yours). */
export function commentLabel(author: string | undefined, me: string, inGroup: boolean): string {
  if (!inGroup || !author) return "Kommentar";
  return author === me ? "Kommentar · Du" : `Kommentar · ${initials(author)}`;
}

const PLACEHOLDER_COLORS = ["#E5D5BA", "#EBC8A8", "#D2DBC6", "#EBDCCB"];

export function placeholderColor(id: string): string {
  let sum = 0;
  for (const char of id) sum += char.charCodeAt(0);
  return PLACEHOLDER_COLORS[sum % PLACEHOLDER_COLORS.length];
}

const PLATFORM_LABELS = { instagram: "Instagram", youtube: "YouTube", web: "Web" } as const;

export function platformLabel(platform: keyof typeof PLATFORM_LABELS): string {
  return PLATFORM_LABELS[platform];
}
