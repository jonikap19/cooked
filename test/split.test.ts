import { describe, expect, it } from "vitest";
import { splitStepText } from "../worker/split";
import { authHeaders, testApp, testEnv } from "./helpers";

const pieces = [
  { text: "Zwiebeln würfeln.", duration_minutes: null },
  { text: "Zwiebeln 5 Minuten anbraten.", duration_minutes: 5 },
  { text: "Mit Brühe ablöschen.", duration_minutes: null },
];
const fakeAi = (run: (model: string, args: any) => Promise<unknown>) => ({ run }) as unknown as Ai;
const ok = (steps: unknown) => fakeAi(async () => ({ response: { steps } }));

describe("splitStepText", () => {
  it("returns the pieces and accepts a JSON string response", async () => {
    expect(await splitStepText(ok(pieces), "x")).toEqual(pieces);
    expect(await splitStepText(fakeAi(async () => ({ response: JSON.stringify({ steps: pieces }) })), "x")).toEqual(pieces);
  });
  it("puts the step text only in the user message and passes max_tokens", async () => {
    let args: any;
    const ai = fakeAi(async (_m, a) => ((args = a), { response: { steps: pieces } }));
    await splitStepText(ai, "SECRET-TEXT");
    const [sys, user] = args.messages;
    expect(sys.content).not.toContain("SECRET-TEXT");
    expect(user).toEqual({ role: "user", content: "SECRET-TEXT" });
    expect(args.max_tokens).toBeGreaterThan(0);
  });
});

describe("POST /api/split-step", () => {
  const app = testApp();
  const call = async (body: unknown, ai: Ai, allow = true) =>
    app.request(
      "/api/split-step",
      { method: "POST", headers: await authHeaders("p@example.com"), body: JSON.stringify(body) },
      testEnv({ AI: ai, PARSE_LIMIT: { limit: async () => ({ success: allow }) } as unknown as RateLimit }),
    );

  it("200 with 3 pieces", async () => {
    const res = await call({ text: "Zwiebeln würfeln, anbraten, ablöschen." }, ok(pieces));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ steps: pieces });
  });
  it("422 when the model returns fewer than 2 pieces", async () => {
    const res = await call({ text: "Kochen." }, ok(pieces.slice(0, 1)));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Dieser Schritt lässt sich nicht weiter aufteilen." });
  });
  it("502 on invalid output (also more than 6 pieces)", async () => {
    for (const ai of [ok("nope"), ok([...pieces, ...pieces, ...pieces]), fakeAi(async () => { throw new Error("boom"); })]) {
      expect((await call({ text: "x" }, ai)).status).toBe(502);
    }
  });
  it("400 on empty or too long text", async () => {
    for (const body of [{ text: "  " }, { text: "a".repeat(2001) }, {}]) {
      expect((await call(body, ok(pieces))).status).toBe(400);
    }
  });
  it("429 when rate limited, without calling the AI", async () => {
    let called = false;
    const res = await call({ text: "x" }, fakeAi(async () => ((called = true), { response: { steps: pieces } })), false);
    expect(res.status).toBe(429);
    expect(called).toBe(false);
  });
});
