// Reads recipe text and an image URL out of a fetched page; see docs/link-import-findings.md.
export type Extracted = {
  /** Text worth sending to the AI, or null when the page has no usable recipe text. */
  text: string | null;
  /** The page's own description, used to pre-fill the text tab. */
  caption: string | null;
  imageUrl: string | null;
};

const MAX_TEXT = 10_000; // same limit as POST /api/parse

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
  ndash: "–", mdash: "—", hellip: "…",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] !== "#") return NAMED_ENTITIES[ref] ?? match;
    const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** `<meta>` content by lower-cased `property`/`name`, first occurrence wins, any attribute order. */
function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  // Split first so a page full of unclosed "<meta" costs linear, not quadratic, time.
  for (const piece of html.split(/<meta\b/i).slice(1)) {
    const tag = /(?:[^>"']|"[^"]*"|'[^']*')*>/y.exec(piece)?.[0];
    if (!tag) continue;
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
    }
    const key = (attrs.property ?? attrs.name)?.toLowerCase();
    const content = attrs.content === undefined ? "" : decodeEntities(attrs.content).trim();
    if (key && content && !tags.has(key)) tags.set(key, content);
  }
  return tags;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function findRecipe(node: unknown): Json | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipe(item);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(node)) return null;
  const type = node["@type"];
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) return node;
  return findRecipe(node["@graph"]);
}

function jsonLdRecipe(html: string): Json | null {
  // Split instead of one big regex: unclosed "<script" must not cost quadratic time.
  for (const piece of html.split(/<script\b/i).slice(1)) {
    const tagEnd = piece.indexOf(">");
    if (tagEnd < 0 || !/\btype\s*=\s*["']?application\/ld\+json\b/i.test(piece.slice(0, tagEnd))) continue;
    const bodyEnd = piece.search(/<\/script>/i);
    if (bodyEnd < tagEnd) continue;
    const body = piece.slice(tagEnd + 1, bodyEnd);
    try {
      const found = findRecipe(JSON.parse(body));
      if (found) return found;
    } catch {
      // broken JSON-LD blocks are common; try the next one
    }
  }
  return null;
}

const text = (v: unknown): string =>
  typeof v === "string" ? decodeEntities(v).trim() : typeof v === "number" ? String(v) : "";

/** HowToSection names become heading lines; their steps are flattened in order. */
function instructionLines(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(instructionLines);
  if (!isObject(v)) return [text(v)].filter(Boolean);
  if (v.itemListElement !== undefined) {
    const heading = text(v.name);
    return [...(heading ? [`${heading}:`] : []), ...instructionLines(v.itemListElement)];
  }
  return [text(v.text) || text(v.name)].filter(Boolean);
}

/** ISO 8601 ("PT1H30M", "P1DT2H") as German text ("1 Std. 30 Min."); "" if unreadable. */
function duration(v: unknown): string {
  const m = typeof v === "string" ? /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?)?$/.exec(v.trim()) : null;
  if (!m) return "";
  const hours = Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0);
  const minutes = Number(m[3] ?? 0);
  return [hours && `${hours} Std.`, minutes && `${minutes} Min.`].filter(Boolean).join(" ");
}

const TIMES = [["totalTime", "Gesamtzeit"], ["prepTime", "Vorbereitung"], ["cookTime", "Kochzeit"]] as const;

function renderRecipe(recipe: Json): string | null {
  const ingredients = (Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient : []).map(text).filter(Boolean);
  const steps = instructionLines(recipe.recipeInstructions);
  if (!ingredients.length && !steps.length) return null;
  const servings = text(Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] : recipe.recipeYield);
  const head = [
    text(recipe.name),
    servings && `Portionen: ${servings}`,
    ...TIMES.map(([key, label]) => duration(recipe[key]) && `${label}: ${duration(recipe[key])}`),
  ].filter(Boolean);
  const blocks = [head.join("\n")];
  if (ingredients.length) blocks.push(["Zutaten:", ...ingredients].join("\n"));
  if (steps.length) blocks.push(["Zubereitung:", ...steps].join("\n"));
  return blocks.filter(Boolean).join("\n\n");
}

function jsonLdImage(v: unknown): string | null {
  if (Array.isArray(v)) return jsonLdImage(v[0]);
  if (isObject(v)) return jsonLdImage(v.url);
  return typeof v === "string" ? decodeEntities(v).trim() : null;
}

// We copy the image right away, but a signed URL is a sign of a host we should not scrape.
function usableImage(url: string | null | undefined): string | null {
  if (!url || !URL.canParse(url) || new URL(url).protocol !== "https:") return null;
  return /[?&](oe|expires|x-amz-expires)=/i.test(url) ? null : url;
}

function youtubeDescription(html: string): string | null {
  const match = /"shortDescription":"((?:[^"\\]|\\.)*)"/.exec(html);
  if (!match) return null;
  try {
    return (JSON.parse(`"${match[1]}"`) as string).trim() || null;
  } catch {
    return null;
  }
}

const cap = (s: string | null | undefined) => (s ? s.slice(0, MAX_TEXT) : null);

export function extractFromHtml(platform: "instagram" | "youtube" | "web", html: string): Extracted {
  const meta = metaTags(html);
  const description = meta.get("og:description") ?? meta.get("description");
  if (platform === "instagram") {
    // Client-rendered behind a login; see the findings doc. Never scraped.
    return { text: null, caption: cap(description), imageUrl: null };
  }
  if (platform === "youtube") {
    const full = youtubeDescription(html);
    return {
      text: cap(full && [meta.get("og:title"), full].filter(Boolean).join("\n\n")),
      caption: cap(full ?? description),
      imageUrl: full ? usableImage(meta.get("og:image")) : null,
    };
  }
  const recipe = jsonLdRecipe(html);
  let rendered: string | null = null;
  try {
    rendered = recipe && renderRecipe(recipe);
  } catch {
    // e.g. stack overflow on absurdly nested instructions: treat as no usable text
  }
  return {
    text: cap(rendered),
    caption: cap(description),
    imageUrl: rendered && recipe ? usableImage(jsonLdImage(recipe.image) ?? meta.get("og:image")) : null,
  };
}
