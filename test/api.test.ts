import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request, SessionExpiredError } from "../src/api";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const stub = (response: Response | Error) => {
  globalThis.fetch = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
};

describe("request", () => {
  it("returns parsed JSON on 200", async () => {
    stub(Response.json({ userId: "a@b.de" }));
    expect(await request("/api/me")).toEqual({ userId: "a@b.de" });
  });

  it("returns undefined on 204", async () => {
    stub(new Response(null, { status: 204 }));
    expect(await request("/api/recipes/1", { method: "DELETE" })).toBeUndefined();
  });

  it("throws ApiError with the server message on 400", async () => {
    stub(Response.json({ error: "x" }, { status: 400 }));
    const error = await request("/api/x").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: "x" });
  });

  it("throws SessionExpiredError when fetch rejects", async () => {
    stub(new TypeError("Failed to fetch"));
    await expect(request("/api/me")).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("throws SessionExpiredError on an HTML 200 (Access login page)", async () => {
    stub(new Response("<html></html>", { headers: { "content-type": "text/html" } }));
    await expect(request("/api/me")).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("throws SessionExpiredError on 401", async () => {
    stub(Response.json({ error: "no" }, { status: 401 }));
    await expect(request("/api/me")).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
