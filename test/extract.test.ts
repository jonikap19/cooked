import { describe, expect, it } from "vitest";
import { extractFromHtml } from "../worker/extract";
import instagram from "./fixtures/instagram.html?raw";
import webJsonLd from "./fixtures/web-jsonld.html?raw";
import webPlain from "./fixtures/web-plain.html?raw";
import youtube from "./fixtures/youtube.html?raw";

const page = (head: string) => `<html><head>${head}</head><body></body></html>`;
const ld = (data: unknown) => page(`<script type="application/ld+json">${JSON.stringify(data)}</script>`);

describe("extractFromHtml: instagram", () => {
  it("never extracts text or images, but keeps og:description as caption", () => {
    expect(extractFromHtml("instagram", instagram)).toEqual({
      text: null,
      caption: "Schnelle Pasta mit Tomaten & Basilikum. 200 g Nudeln kochen.",
      imageUrl: null,
    });
  });
  it("caption is null for the plain app shell", () => {
    expect(extractFromHtml("instagram", page("<title>Instagram</title>")).caption).toBeNull();
  });
});

describe("extractFromHtml: youtube", () => {
  it("uses og:title and the unescaped shortDescription", () => {
    const r = extractFromHtml("youtube", youtube);
    expect(r.text).toBe(
      'Ofengemüse in 30 Minuten – ganz einfach\n\nZutaten:\n500 g Kartoffeln\n2 Paprika "rot"\n\nZubereitung:\nAlles schneiden und 30 Minuten bei 200 Grad backen. Fertig.',
    );
    expect(r.caption).toContain("Zutaten:\n500 g Kartoffeln");
    expect(r.imageUrl).toBe("https://i.ytimg.com/vi/abc123/maxresdefault.jpg");
  });
  it("without shortDescription: no text, og:description as caption", () => {
    const r = extractFromHtml("youtube", page('<meta property="og:description" content="Kurz &amp; knapp">'));
    expect(r).toEqual({ text: null, caption: "Kurz & knapp", imageUrl: null });
  });
});

describe("extractFromHtml: web", () => {
  it("renders a JSON-LD recipe from @graph with sections, yield, time and image", () => {
    const r = extractFromHtml("web", webJsonLd);
    expect(r.text).toBe(
      [
        "Linsensuppe & Speck",
        "Portionen: 4",
        "Gesamtzeit: 1 Std. 30 Min.",
        "",
        "Zutaten:",
        "250 g Linsen",
        "1 Zwiebel",
        "100 g Speck",
        "",
        "Zubereitung:",
        "Vorbereitung:",
        "Zwiebel würfeln.",
        "Speck anbraten.",
        "Kochen:",
        "Linsen zugeben und 40 Minuten köcheln.",
      ].join("\n"),
    );
    expect(r.text).not.toContain("Body text");
    expect(r.caption).toBe("Eine wärmende Linsensuppe.");
    expect(r.imageUrl).toBe("https://img.example-cdn.de/linsensuppe-gross.jpg?resize=800,600");
  });

  it("handles string instructions, numeric yield, @type string and image arrays", () => {
    const r = extractFromHtml(
      "web",
      ld({
        "@type": "Recipe",
        name: "Toast",
        recipeYield: 2,
        cookTime: "PT5M",
        recipeIngredient: ["2 Scheiben Brot"],
        recipeInstructions: "Brot toasten.",
        image: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
      }),
    );
    expect(r.text).toBe("Toast\nPortionen: 2\nKochzeit: 5 Min.\n\nZutaten:\n2 Scheiben Brot\n\nZubereitung:\nBrot toasten.");
    expect(r.imageUrl).toBe("https://cdn.example.com/a.jpg");
  });

  it("handles a top-level array and plain HowToStep / string steps", () => {
    const r = extractFromHtml(
      "web",
      ld([{ "@type": "Organization" }, { "@type": "Recipe", name: "Tee", recipeInstructions: [{ "@type": "HowToStep", text: "Wasser kochen." }, "Ziehen lassen."] }]),
    );
    expect(r.text).toBe("Tee\n\nZubereitung:\nWasser kochen.\nZiehen lassen.");
  });

  it("without a JSON-LD recipe: no text, description as caption, no body scraping", () => {
    expect(extractFromHtml("web", webPlain)).toEqual({
      text: null,
      caption: "Unsere liebsten Rezepte für den Herbst & Winter.",
      imageUrl: null,
    });
  });

  it("prefers og:description and tolerates single quotes and numeric entities", () => {
    const r = extractFromHtml(
      "web",
      page(`<meta name="description" content="meta"><META content='Tom &#38; Jerry &#x2013; Kuchen' PROPERTY='og:description'>`),
    );
    expect(r.caption).toBe("Tom & Jerry – Kuchen");
  });

  it("drops non-https and expiring image urls", () => {
    expect(extractFromHtml("web", page('<meta property="og:image" content="http://x.example.com/a.jpg">')).imageUrl).toBeNull();
    expect(
      extractFromHtml("web", page('<meta property="og:image" content="https://s3.example.com/a.jpg?X-Amz-Expires=300">')).imageUrl,
    ).toBeNull();
  });

  it("caps the text at 10 000 characters", () => {
    const r = extractFromHtml("web", ld({ "@type": "Recipe", name: "Lang", recipeInstructions: "x".repeat(20000) }));
    expect(r.text).toHaveLength(10000);
  });
});

describe("extractFromHtml: hostile pages", () => {
  it("scans unclosed <meta and <script tags in linear time", () => {
    for (const piece of ["<meta ", '<script type="application/ld+json">']) {
      const started = performance.now();
      const result = extractFromHtml("web", piece.repeat(500_000 / piece.length));
      expect(performance.now() - started).toBeLessThan(500);
      expect(result.text).toBeNull();
    }
  });
  it("returns no text for absurdly nested instructions instead of throwing", () => {
    let nested: unknown = { text: "Rühren" };
    for (let i = 0; i < 20_000; i++) nested = { name: "Teil", itemListElement: [nested] };
    const html = ld({ "@type": "Recipe", name: "X", recipeInstructions: nested });
    expect(extractFromHtml("web", html).text).toBeNull();
  });
  it("finds an image nested absurdly deep instead of throwing", () => {
    let image: unknown = { url: "https://example.com/tief.jpg" };
    for (let i = 0; i < 20_000; i++) image = [image];
    const html = ld({ "@type": "Recipe", name: "X", recipeInstructions: "Rühren", image });
    expect(extractFromHtml("web", html).imageUrl).toBe("https://example.com/tief.jpg");
  });
});
