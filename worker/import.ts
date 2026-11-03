import { Hono } from "hono";
import { z } from "zod";
import { detectPlatform } from "../shared/format";
import { HttpsUrl, type ParsedRecipe } from "../shared/schema";
import type { AppEnv } from "./auth";
import { extractFromHtml } from "./extract";
import { FetchRejected, safeFetch } from "./fetch-guard";
import { ParseError, parseFailed, parseRecipeText, tooManyRequests } from "./parse";
import { invalid, readJson } from "./recipes";

export const importLink = new Hono<AppEnv>();

const Body = z.object({ url: HttpsUrl });
const unsupported = { error: "Nicht unterstützter Link" };
const unreadable = (caption: string | null) => ({
  error: "Link konnte nicht gelesen werden. Füge den Text der Beschreibung ein.",
  caption,
});
const notFound = { error: "Nicht gefunden" };

// SVG is left out on purpose: served from our origin it could run script.
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

/** Copies the page's image into R2 under a tmp key; any failure just means no image. */
async function storeTmpImage(images: R2Bucket, imageUrl: string, userId: string): Promise<string | null> {
  try {
    const { contentType, body } = await safeFetch(imageUrl, { accept: "image" });
    const type = contentType.split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) return null;
    const key = `tmp/${crypto.randomUUID()}`;
    await images.put(key, body, { httpMetadata: { contentType: type }, customMetadata: { owner: userId } });
    return `/api/images/${key}`;
  } catch (e) {
    console.warn("import: image skipped:", e instanceof FetchRejected ? e.reason : "store");
    return null;
  }
}

importLink.post("/api/import-link", async (c) => {
  const body = Body.safeParse(await readJson(c));
  if (!body.success) return c.json(invalid, 400);
  const { success } = await c.env.PARSE_LIMIT.limit({ key: c.var.userId });
  if (!success) return c.json(tooManyRequests, 429);

  const url = body.data.url;
  const platform = detectPlatform(url) ?? "web";
  let html: string;
  try {
    // ponytail: UTF-8 only; read the charset from Content-Type if a non-UTF-8 site matters
    html = new TextDecoder().decode((await safeFetch(url)).body);
  } catch (e) {
    if (!(e instanceof FetchRejected)) throw e;
    console.warn("import: page rejected:", e.reason);
    return e.reason === "scheme" || e.reason === "host" ? c.json(unsupported, 400) : c.json(unreadable(null), 422);
  }

  const { text, caption, imageUrl } = extractFromHtml(platform, html);
  if (!text) {
    console.warn("import: no usable text on", platform);
    return c.json(unreadable(caption), 422);
  }
  let recipe: ParsedRecipe;
  try {
    recipe = await parseRecipeText(c.env.AI, text);
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    return c.json(parseFailed, 502);
  }
  const image_url = imageUrl ? await storeTmpImage(c.env.IMAGES, imageUrl, c.var.userId) : null;
  return c.json({ recipe, source_url: url, source_platform: platform, image_url, caption });
});

function imageResponse(object: R2ObjectBody): Response {
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

importLink.get("/api/images/tmp/:uuid", async (c) => {
  const object = await c.env.IMAGES.get(`tmp/${c.req.param("uuid")}`);
  if (!object || object.customMetadata?.owner !== c.var.userId) {
    await object?.body.cancel();
    return c.json(notFound, 404);
  }
  return imageResponse(object);
});

importLink.get("/api/images/:id", async (c) => {
  const id = c.req.param("id");
  const owned = await c.env.DB.prepare("SELECT 1 AS x FROM recipes WHERE id = ? AND user_id = ?").bind(id, c.var.userId).first();
  const object = owned ? await c.env.IMAGES.get(id) : null;
  return object ? imageResponse(object) : c.json(notFound, 404);
});
