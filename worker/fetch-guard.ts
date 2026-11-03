export type FetchRejectedReason = "scheme" | "host" | "redirect" | "size" | "type" | "timeout" | "status";

export class FetchRejected extends Error {
  constructor(readonly reason: FetchRejectedReason) {
    super(`fetch rejected: ${reason}`);
  }
}

type Accept = "html" | "image";
type SafeFetchOptions = {
  maxBytes?: number;
  accept?: Accept;
  /** Test-only; production uses the 10 s default. */
  timeoutMs?: number;
};

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES: Record<Accept, number> = { html: 2 * 1024 * 1024, image: 5 * 1024 * 1024 };
const CONTENT_TYPE_PREFIX: Record<Accept, string> = { html: "text/html", image: "image/" };
const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "de-DE",
};

// ponytail: checks the hostname only; DNS rebinding of a public name to a private IP is not
// detected. Workers egress cannot reach private networks, so this is accepted. Upgrade path:
// resolve via DNS-over-HTTPS and check the answers.
function parseAllowedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRejected("scheme");
  }
  if (url.protocol !== "https:") throw new FetchRejected("scheme");
  // The URL parser already normalises IPv4 forms (decimal, hex, octal) to dotted decimal.
  const host = url.hostname.replace(/\.$/, "");
  const isIpv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const isDnsName =
    !host.startsWith("[") &&
    host.split(".").every(Boolean) &&
    !isIpv4 &&
    host.includes(".") &&
    host !== "localhost" &&
    !/\.(localhost|local|internal)$/.test(host);
  if (!isDnsName || url.username || url.password || url.port) throw new FetchRejected("host");
  return url;
}

async function readLimited(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new FetchRejected("size");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchRejected("size");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

async function fetchFollowingRedirects(rawUrl: string, accept: Accept, maxBytes: number, signal: AbortSignal) {
  let url = parseAllowedUrl(rawUrl);
  for (let hops = 0; ; hops++) {
    const response = await fetch(url.href, { redirect: "manual", headers: REQUEST_HEADERS, signal });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new FetchRejected("status");
      if (hops === MAX_REDIRECTS) throw new FetchRejected("redirect");
      url = parseAllowedUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new FetchRejected("status");
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith(CONTENT_TYPE_PREFIX[accept])) {
      await response.body?.cancel();
      throw new FetchRejected("type");
    }
    return { finalUrl: url.href, contentType, body: await readLimited(response, maxBytes) };
  }
}

/** The only place the Worker fetches a user-supplied URL. Only ever throws FetchRejected. */
export async function safeFetch(
  url: string,
  { accept = "html", maxBytes = DEFAULT_MAX_BYTES[accept], timeoutMs = TIMEOUT_MS }: SafeFetchOptions = {},
): Promise<{ finalUrl: string; contentType: string; body: ArrayBuffer }> {
  const signal = AbortSignal.timeout(timeoutMs);
  // Raced explicitly so a hung fetch or body read cannot outlive the deadline.
  const deadline = new Promise<never>((_, reject) =>
    signal.addEventListener("abort", () => reject(new FetchRejected("timeout"))),
  );
  try {
    return await Promise.race([fetchFollowingRedirects(url, accept, maxBytes, signal), deadline]);
  } catch (error) {
    if (error instanceof FetchRejected) throw error;
    throw new FetchRejected(signal.aborted ? "timeout" : "status");
  }
}
