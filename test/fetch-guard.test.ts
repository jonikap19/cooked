import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchRejected, safeFetch } from "../worker/fetch-guard";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const stub = (...responses: Array<Response | ((init?: RequestInit) => Promise<Response>)>) => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const next = responses.shift()!;
    return typeof next === "function" ? next(init) : next;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};
const html = (body = "<p>hi</p>", headers: Record<string, string> = {}) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const redirect = (location?: string) =>
  new Response(null, { status: 302, headers: location ? { location } : {} });
const rejection = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(FetchRejected);
  return (error as FetchRejected).reason;
};

describe("safeFetch URL checks", () => {
  it("rejects non-https schemes", async () => {
    const fetchMock = stub();
    expect(await rejection(safeFetch("http://example.com/"))).toBe("scheme");
    expect(await rejection(safeFetch("ftp://example.com/"))).toBe("scheme");
    expect(await rejection(safeFetch("not a url"))).toBe("scheme");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "https://127.0.0.1/",
    "https://2130706433/",
    "https://0x7f.0.0.1/",
    "https://0177.0.0.1/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://localhost/",
    "https://localhost./",
    "https://app.localhost/",
    "https://printer.local/",
    "https://db.internal/",
    "https://intranet/",
    "https://user:pass@example.com/",
    "https://example.com:8443/",
  ])("rejects host %s without fetching", async (url) => {
    const fetchMock = stub();
    expect(await rejection(safeFetch(url))).toBe("host");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("safeFetch fetching", () => {
  it("returns body, final url and content type, sending only generic headers", async () => {
    const fetchMock = stub(html("<p>hallo</p>"));
    const result = await safeFetch("https://example.com/rezept");
    expect(result.finalUrl).toBe("https://example.com/rezept");
    expect(result.contentType).toContain("text/html");
    expect(new TextDecoder().decode(result.body)).toBe("<p>hallo</p>");
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.redirect).toBe("manual");
    const headers = new Headers(init.headers);
    expect([...headers.keys()].sort()).toEqual(["accept-language", "user-agent"]);
    expect(headers.get("accept-language")).toBe("de-DE");
  });

  it("follows relative redirects and reports the final url", async () => {
    stub(redirect("/neu"), html());
    expect((await safeFetch("https://example.com/alt")).finalUrl).toBe("https://example.com/neu");
  });

  it("re-validates each hop", async () => {
    stub(redirect("https://10.0.0.1/"));
    expect(await rejection(safeFetch("https://example.com/"))).toBe("host");
    stub(redirect("http://example.com/"));
    expect(await rejection(safeFetch("https://example.com/"))).toBe("scheme");
  });

  it("allows 3 redirects but not a 4th", async () => {
    stub(redirect("/1"), redirect("/2"), redirect("/3"), html());
    await safeFetch("https://example.com/");
    stub(redirect("/1"), redirect("/2"), redirect("/3"), redirect("/4"));
    expect(await rejection(safeFetch("https://example.com/"))).toBe("redirect");
  });

  it("rejects a redirect without Location as status", async () => {
    stub(redirect());
    expect(await rejection(safeFetch("https://example.com/"))).toBe("status");
  });

  it("rejects non-2xx", async () => {
    stub(new Response("nope", { status: 404, headers: { "content-type": "text/html" } }));
    expect(await rejection(safeFetch("https://example.com/"))).toBe("status");
  });

  it("maps network errors to status", async () => {
    stub(async () => {
      throw new TypeError("connection refused");
    });
    expect(await rejection(safeFetch("https://example.com/"))).toBe("status");
  });

  it("checks the content type before reading the body", async () => {
    stub(new Response("%PDF", { headers: { "content-type": "application/pdf" } }));
    expect(await rejection(safeFetch("https://example.com/"))).toBe("type");
    stub(html());
    expect(await rejection(safeFetch("https://example.com/", { accept: "image" }))).toBe("type");
    stub(new Response("png", { headers: { "content-type": "image/png" } }));
    expect((await safeFetch("https://example.com/", { accept: "image" })).contentType).toBe("image/png");
  });
});

describe("safeFetch size limit", () => {
  it("rejects 3 MB html by default (stream without Content-Length)", async () => {
    stub(html("a".repeat(3 * 1024 * 1024)));
    expect(await rejection(safeFetch("https://example.com/"))).toBe("size");
  });

  it("rejects early on a large Content-Length", async () => {
    stub(html("small", { "content-length": String(3 * 1024 * 1024) }));
    expect(await rejection(safeFetch("https://example.com/"))).toBe("size");
  });

  it("enforces the limit while streaming even if Content-Length lies, and cancels", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    stub(new Response(body, { headers: { "content-type": "text/html", "content-length": "10" } }));
    expect(await rejection(safeFetch("https://example.com/", { maxBytes: 4096 }))).toBe("size");
    expect(cancelled).toBe(true);
  });

  it("allows images up to 5 MB by default", async () => {
    stub(new Response(new Uint8Array(3 * 1024 * 1024), { headers: { "content-type": "image/jpeg" } }));
    expect((await safeFetch("https://example.com/a.jpg", { accept: "image" })).body.byteLength).toBe(3 * 1024 * 1024);
  });
});

describe("safeFetch timeout", () => {
  it("rejects a fetch that never resolves", async () => {
    stub(() => new Promise<Response>(() => {}));
    expect(await rejection(safeFetch("https://example.com/", { timeoutMs: 20 }))).toBe("timeout");
  });

  it("covers body reading too", async () => {
    stub(new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { headers: { "content-type": "text/html" } }));
    expect(await rejection(safeFetch("https://example.com/", { timeoutMs: 20 }))).toBe("timeout");
  });
});
