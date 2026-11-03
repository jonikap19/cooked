const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
const DURATION = new RegExp(
  String.raw`(?<![\p{L}\d])(?:(eineinhalb|anderthalb|eine halbe|eine) (?:stunden?)|(${NUMBER})(?:\s*(?:–|-|bis)\s*${NUMBER})?\s*(min(?:uten?)?|std|stunden?|sek(?:unden?)?))\.?(?!\p{L})`,
  "iu",
);
const WORD_MINUTES: Record<string, number> = { "eine halbe": 30, eine: 60, anderthalb: 90, eineinhalb: 90 };

/** Minutes of the first duration in German step text (ranges: lower bound), or null. */
export function detectDuration(text: string): number | null {
  const match = DURATION.exec(text);
  if (!match) return null;
  const [, word, amount, unit] = match;
  if (word) return WORD_MINUTES[word.toLowerCase()];
  const unitStart = unit.slice(0, 3).toLowerCase();
  const factor = unitStart === "min" ? 1 : unitStart === "sek" ? 1 / 60 : 60;
  return Math.max(1, Math.ceil(Number(amount.replace(",", ".")) * factor - 1e-9));
}
