# Link import findings (Task D1 spike)

Method: throwaway Worker run with `wrangler dev --remote` (real Cloudflare egress), plain `fetch` with a desktop Chrome User-Agent and `Accept-Language: de-DE`. Probe deleted afterwards; nothing deployed. Date: 2026-11-03. Pages are public; only structure is recorded.

## Results

| Source | Status | Wall? | Caption / text lives in | og:image | Image expiry |
|---|---|---|---|---|---|
| Instagram `/p/...` and `/reel/...` (3 different ids) | 200 | No login redirect, but the body is the same ~500 KB JS app shell, `<title>Instagram</title>` | Nowhere: no `og:*`, no `<meta name=description>`, no JSON-LD | Absent | n/a |
| YouTube watch (`/watch?v=`, `youtu.be/`) | 200 | No consent page from Worker egress | `ytInitialPlayerResponse.videoDetails.shortDescription` (full text, 2.4 KB in test); also `og:description` and `<meta name=description>` (truncated to ~160 chars) | Present, `i.ytimg.com`, no query params | Stable, not signed |
| YouTube Shorts (`/shorts/<id>`) | 200 | No | Same as watch (the page served is the watch page) | Same | Same |
| Chefkoch recipe (JSON-LD) | 200 | No | JSON-LD `@type: Recipe` (`recipeIngredient`, `recipeInstructions` as `HowToSection`/`HowToStep`); `og:description` is a short blurb | Present, `img.chefkoch-cdn.de`, no query params | Stable, not signed |
| BBC Good Food recipe (JSON-LD) | 200 | No | JSON-LD `Recipe` (one of several ld+json blocks, plus `VideoObject`, `BreadcrumbList`, ...) | Present, `images.immediate.co.uk?resize=` | Stable, not signed |
| Blog/landing pages without Recipe JSON-LD (eat-this.org, kochbar.de home) | 200 | No | Only `og:description` / `<meta name=description>` (~155 chars); no recipe text in metadata | eat-this: present; kochbar: absent | Stable (own host) |

Notes and limits:
- Redirects are followed by `fetch` (chefkoch redirects wrong slugs to the right page; shorts and youtu.be end on the watch page). D2's guard must re-check every hop.
- Instagram's shell was identical from this machine via curl, so it is not an IP-reputation issue; the content is client-rendered. `og:*` tags are only served to link-preview crawlers, and impersonating one is not something we should do.
- The Instagram CDN `oe=` expiry question is moot: no image URL is reachable. (If an image URL ever came from Instagram it would be signed and expire, so it must not be stored as a hotlink.)


## Decisions

- **Instagram: (c) not supported, text-tab fallback.** Nothing is readable without a login or the Graph API (which needs an app review and a token). Show "Link konnte nicht gelesen werden. Füge den Text der Beschreibung ein." and switch to the text tab. Pre-fill is empty (we got no caption).
- **YouTube (watch and Shorts): (a) HTML extraction.** The full description is in the HTML, so no API key is needed (closed decision, see below).
- **Recipe websites: (a) HTML extraction.** Prefer JSON-LD `Recipe`; fall back to `og:title` + `og:description` + body text only if D3 chooses to; otherwise fallback to the text tab with the description pre-filled.

## Implications for D3 (extractor)

Read from the fetched HTML, in this order:

1. **JSON-LD:** every `<script type="application/ld+json">`; parse each (try/catch), flatten arrays and `@graph`, find the node whose `@type` is `"Recipe"` or an array containing it. Use `name`, `description`, `recipeIngredient[]`, `recipeInstructions` (string, or array of strings / `HowToStep` `.text` / `HowToSection.itemListElement[].text`), `recipeYield`, `totalTime`/`prepTime`/`cookTime` (ISO 8601), `image` (string, array, or `ImageObject.url`), `keywords`.
2. **YouTube:** regex `"shortDescription":"((?:[^"\\]|\\.)*)"` on the HTML, then `JSON.parse('"' + match + '"')` to unescape; title from `og:title`. Do not eval the whole `ytInitialPlayerResponse` (about 1.4 MB page). If missing, use `og:description` (truncated) as the pre-fill and show the fallback message.
3. **Generic:** `og:title`, `og:description` (then `<meta name="description">`), `og:image`. Decode HTML entities (`&amp;` appears in descriptions).
4. **Image:** accept `og:image` / JSON-LD `image` only if it is https and passes the same URL guard; store the URL only (no download). Hosts seen are stable and unsigned. Skip it for Instagram (none) and if the URL has an expiry-looking param (`oe=`, `Expires=`, `X-Amz-Expires`).
5. **Failure rule:** wall, non-200, no recipe text, or Instagram host: return whatever caption we got (maybe empty) and the German fallback message; never a 500.
6. Size: follow D2's rule unchanged: HTML cap 2 MB, a larger response is rejected (FetchRejected "size"); no truncating and no stop-after-`shortDescription` streaming. The largest page seen was ~1.4 MB (YouTube), so an oversized page falls back to the text tab.

## Untested

- YouTube consent redirect (`consent.youtube.com`): never appeared from Worker egress. Expected handling: no `shortDescription` found, so fallback to the text tab.
- Recipe page without JSON-LD whose recipe is only in the body (only landing pages tested). Expected handling: no usable recipe text, so fallback to the text tab with `og:description` pre-filled.

## Closed decision

No `YOUTUBE_API_KEY`; YouTube uses HTML extraction only. Upgrade path if the markup changes or consent walls appear: YouTube Data API v3 `videos.list?part=snippet` with a Worker secret.
