import type { Recipe } from "./schema";

export function scaleAmount(amount: number | null, base: number, target: number): number | null {
  return amount === null ? null : (amount * target) / base;
}

export function formatAmount(amount: number | null): string {
  if (amount === null) return "";
  return String(Math.round(amount * 100) / 100).replace(".", ",");
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
  return shortDate.format(new Date(iso));
}

export function initials(email: string): string {
  const parts = email.split("@")[0].split(/[._-]/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
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
