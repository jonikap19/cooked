import { describe, expect, it, vi } from "vitest";
import { UNITS } from "../shared/units";
import { PARSE_TIMEOUT_MS, parseRecipeText, ParseError, SYSTEM_PROMPT } from "../worker/parse";
import { authHeaders, testApp, testEnv } from "./helpers";

const recipe = {
  title: "Pasta",
  servings: 2,
  total_minutes: 25,
  ingredients: [
    { name: "Nudeln", amount: 200, unit: "g", spice: false },
    { name: "Salz", amount: null, unit: "", spice: true },
  ],
  steps: [{ text: "Kochen", duration_minutes: 10 }],
};
const fakeAi = (run: () => Promise<unknown>) => ({ run }) as unknown as Ai;
const ok = (response: unknown) => fakeAi(async () => ({ response }));

it("lists every unit in the system prompt", () => {
  for (const unit of UNITS.filter(Boolean)) expect(SYSTEM_PROMPT).toContain(unit);
});

describe("parseRecipeText", () => {
  it("returns a valid response object and keeps amount null", async () => {
    const r = await parseRecipeText(ok(recipe), "x");
    expect(r).toEqual(recipe);
    expect(r.ingredients[1].amount).toBeNull();
  });
  it("parses a JSON string response", async () => {
    expect(await parseRecipeText(ok(JSON.stringify(recipe)), "x")).toEqual(recipe);
  });
  it("throws on schema violations", async () => {
    await expect(parseRecipeText(ok({ ...recipe, servings: 0 }), "x")).rejects.toThrow();
    await expect(parseRecipeText(ok({ ...recipe, steps: undefined }), "x")).rejects.toThrow();
    await expect(parseRecipeText(ok("not json"), "x")).rejects.toThrow();
  });
  it("throws when JSON mode cannot be met", async () => {
    const ai = fakeAi(async () => {
      throw new Error("JSON Mode couldn't be met");
    });
    await expect(parseRecipeText(ai, "x")).rejects.toThrow();
  });
  it("gives up on a model call that never answers", async () => {
    vi.useFakeTimers();
    try {
      const result = parseRecipeText(fakeAi(() => new Promise(() => {})), "x");
      const check = expect(result).rejects.toBeInstanceOf(ParseError);
      await vi.advanceTimersByTimeAsync(PARSE_TIMEOUT_MS);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });
  it("puts user text only in the user message", async () => {
    let args: any;
    const ai = fakeAi((async (_m: string, a: unknown) => ((args = a), { response: recipe })) as never);
    await parseRecipeText(ai, "SECRET-TEXT");
    const [sys, user] = args.messages;
    expect([sys.role, user.role]).toEqual(["system", "user"]);
    expect(sys.content).not.toContain("SECRET-TEXT");
    expect(user.content).toBe("SECRET-TEXT");
    expect(args.response_format.json_schema.$schema).toBeUndefined();
  });
  it("tells the model to keep one work step per step", async () => {
    let args: any;
    const ai = fakeAi((async (_m: string, a: unknown) => ((args = a), { response: recipe })) as never);
    await parseRecipeText(ai, "x");
    expect(args.messages[0].content).toContain("Ein Arbeitsschritt pro Schritt");
  });
  it("asks for enough output tokens", async () => {
    let args: any;
    const ai = fakeAi((async (_m: string, a: unknown) => ((args = a), { response: recipe })) as never);
    await parseRecipeText(ai, "x");
    expect(args.max_tokens).toBeGreaterThanOrEqual(2048);
  });
});

describe("POST /api/parse", () => {
  const app = testApp();
  const call = async (body: unknown, ai: Ai, allow = true) =>
    app.request(
      "/api/parse",
      { method: "POST", headers: await authHeaders("p@example.com"), body: JSON.stringify(body) },
      testEnv({
        AI: ai,
        PARSE_LIMIT: { limit: async () => ({ success: allow }) } as unknown as RateLimit,
      }),
    );

  it("200 with the parsed recipe", async () => {
    const res = await call({ text: " Pasta " }, ok(recipe));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(recipe);
  });
  it("502 on unusable model output and on JSON mode failure", async () => {
    const msg = { error: "Rezept konnte nicht erkannt werden. Bitte Text prüfen." };
    for (const ai of [
      ok({ ...recipe, servings: 0 }),
      fakeAi(async () => {
        throw new Error("JSON Mode couldn't be met");
      }),
    ]) {
      const res = await call({ text: "x" }, ai);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual(msg);
    }
  });
  it("400 on empty, whitespace, too long or missing text", async () => {
    for (const body of [{ text: "" }, { text: "   " }, { text: "a".repeat(10001) }, {}]) {
      expect((await call(body, ok(recipe))).status).toBe(400);
    }
    expect((await call({ text: "a".repeat(10000) }, ok(recipe))).status).toBe(200);
  });
  it("429 when rate limited, without calling the AI", async () => {
    let called = false;
    const ai = fakeAi(async () => ((called = true), { response: recipe }));
    const res = await call({ text: "x" }, ai, false);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Zu viele Anfragen, bitte kurz warten." });
    expect(called).toBe(false);
  });
});
