import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authHeaders, testApp, testEnv } from "./helpers";
import instagram from "./fixtures/instagram.html?raw";
import webJsonLd from "./fixtures/web-jsonld.html?raw";
import webPlain from "./fixtures/web-plain.html?raw";

const app = testApp();
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const PAGE = "https://rezepte.example.com/linsensuppe";
const IMAGE = "https://img.example-cdn.de/linsensuppe-gross.jpg?resize=800,600";
const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const fallback = "Link konnte nicht gelesen werden. Füge den Text der Beschreibung ein.";

const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
const image = (type = "image/jpeg") => new Response(IMAGE_BYTES, { headers: { "content-type": type } });

/** Stubs global fetch with one response factory per URL; unknown URLs fail the test. */
function stubFetch(routes: Record<string, () => Response>) {
  const mock = vi.fn(async (url: string) => {
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

const recipe = {
  title: "Linsensuppe",
  servings: 4,
  total_minutes: 90,
  ingredients: [{ name: "Linsen", amount: 250, unit: "g" }],
  steps: [{ text: "Kochen", duration_minutes: 40 }],
};
let aiInput: string | undefined;
const okAi = { run: async (_m: string, args: { messages: { content: string }[] }) => ((aiInput = args.messages[1].content), { response: recipe }) } as unknown as Ai;
const failingAi = { run: async () => ({ response: "kaputt" }) } as unknown as Ai;
const allow = { limit: async () => ({ success: true }) } as unknown as RateLimit;

let n = 0;
const user = () => `imp${++n}-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function call(email: string, path: string, method = "GET", body?: unknown, overrides = {}) {
  return app.request(
    path,
    { method, headers: await authHeaders(email), body: body === undefined ? undefined : JSON.stringify(body) },
    testEnv({ AI: okAi, PARSE_LIMIT: allow, ...overrides }),
  );
}
const importLink = (email: string, url: unknown, overrides = {}) => call(email, "/api/import-link", "POST", { url }, overrides);

async function importWithImage(email: string) {
  stubFetch({ [PAGE]: () => html(webJsonLd), [IMAGE]: () => image() });
  const res = await importLink(email, PAGE);
  expect(res.status).toBe(200);
  return (await res.json()) as { image_url: string };
}

const save = (email: string, image_url: unknown) =>
  call(email, "/api/recipes", "POST", { ...recipe, source_url: PAGE, source_platform: "web", image_url });

describe("POST /api/import-link", () => {
  it("200: extracts the JSON-LD recipe, parses it and stores the image as a tmp handle", async () => {
    const a = user();
    const fetchMock = stubFetch({ [PAGE]: () => html(webJsonLd), [IMAGE]: () => image() });
    const res = await importLink(a, PAGE);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ recipe, source_url: PAGE, source_platform: "web", caption: "Eine wärmende Linsensuppe." });
    expect(body.image_url).toMatch(/^\/api\/images\/tmp\/[0-9a-f-]{36}$/);
    expect(aiInput).toContain("250 g Linsen");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const img = await call(a, body.image_url as string);
    expect(img.status).toBe(200);
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(IMAGE_BYTES);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(img.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await call(user(), body.image_url as string)).status).toBe(404);
  });

  it("an image failure is not fatal", async () => {
    for (const bad of [() => html("<p>nope</p>"), () => image("image/svg+xml"), () => new Response("x", { status: 500 })]) {
      stubFetch({ [PAGE]: () => html(webJsonLd), [IMAGE]: bad });
      const res = await importLink(user(), PAGE);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { image_url: unknown }).image_url).toBeNull();
    }
  });

  it("422 with the caption when the page has no usable text", async () => {
    stubFetch({ [PAGE]: () => html(webPlain) });
    const res = await importLink(user(), PAGE);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: fallback, caption: "Unsere liebsten Rezepte für den Herbst & Winter." });
  });

  it("422 for Instagram, with og:description as caption and no AI call", async () => {
    aiInput = undefined;
    const url = "https://www.instagram.com/p/abc/";
    stubFetch({ [url]: () => html(instagram) });
    const res = await importLink(user(), url);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: fallback, caption: "Schnelle Pasta mit Tomaten & Basilikum. 200 g Nudeln kochen." });
    expect(aiInput).toBeUndefined();
  });

  it("422 with caption null when the fetch is rejected for status/type/size", async () => {
    for (const bad of [() => new Response("x", { status: 503 }), () => new Response("{}", { headers: { "content-type": "application/json" } })]) {
      stubFetch({ [PAGE]: bad });
      const res = await importLink(user(), PAGE);
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: fallback, caption: null });
    }
  });

  it("400 Nicht unterstützter Link for IP and localhost hosts, without fetching", async () => {
    const fetchMock = stubFetch({});
    for (const url of ["https://127.0.0.1/rezept", "https://localhost/x"]) {
      const res = await importLink(user(), url);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Nicht unterstützter Link" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 for invalid bodies, non-https and overlong urls", async () => {
    stubFetch({});
    for (const url of [undefined, 42, "http://example.com/x", "javascript:alert(1)", `https://example.com/${"a".repeat(2040)}`]) {
      expect((await importLink(user(), url)).status).toBe(400);
    }
  });

  it("502 when the AI output is unusable, 429 when rate limited", async () => {
    stubFetch({ [PAGE]: () => html(webJsonLd), [IMAGE]: () => image() });
    expect((await importLink(user(), PAGE, { AI: failingAi })).status).toBe(502);
    const deny = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    expect((await importLink(user(), PAGE, { PARSE_LIMIT: deny })).status).toBe(429);
  });
});

describe("recipe images", () => {
  it("moves the tmp image to the recipe on save and serves it only to the owner", async () => {
    const a = user();
    const { image_url } = await importWithImage(a);
    const saved = await save(a, image_url);
    expect(saved.status).toBe(201);
    const { id } = (await saved.json()) as { id: string };

    const full = (await (await call(a, `/api/recipes/${id}`)).json()) as { recipe: { image_url: string } };
    expect(full.recipe.image_url).toBe(`/api/images/${id}`);
    expect((await call(a, image_url)).status).toBe(404); // tmp object is gone

    const img = await call(a, `/api/images/${id}`);
    expect(img.status).toBe(200);
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(IMAGE_BYTES);
    expect(img.headers.get("cache-control")).toBe("private, max-age=86400");
    expect((await call(user(), `/api/images/${id}`)).status).toBe(404);
  });

  it("ignores someone else's or a missing tmp image", async () => {
    const bob = user();
    const { image_url } = await importWithImage(bob);
    const alice = user();
    for (const url of [image_url, `/api/images/tmp/${crypto.randomUUID()}`]) {
      const { id } = (await (await save(alice, url)).json()) as { id: string };
      const full = (await (await call(alice, `/api/recipes/${id}`)).json()) as { recipe: { image_url: unknown } };
      expect(full.recipe.image_url).toBeNull();
    }
    expect((await call(bob, image_url)).status).toBe(200); // Bob's tmp object is untouched
  });

  it("rejects image_url values that are not a tmp handle", async () => {
    for (const url of ["https://evil.example.com/a.jpg", "/api/images/some-recipe-id", "/api/images/tmp/../x"]) {
      expect((await save(user(), url)).status).toBe(400);
    }
  });

  it("deleting a recipe deletes its image", async () => {
    const a = user();
    const { image_url } = await importWithImage(a);
    const { id } = (await (await save(a, image_url)).json()) as { id: string };
    expect(await env.IMAGES.get(id)).not.toBeNull();
    expect((await call(a, `/api/recipes/${id}`, "DELETE")).status).toBe(204);
    expect(await env.IMAGES.get(id)).toBeNull();
  });
});
