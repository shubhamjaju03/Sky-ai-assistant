/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

const ALLOWED_RESEARCH_ORIGINS = new Set([
  "capacitor://localhost",
  "http://localhost",
  "https://localhost",
]);

function researchResponseHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  return origin && ALLOWED_RESEARCH_ORIGINS.has(origin)
    ? {
        "Access-Control-Allow-Headers": "Accept",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
      }
    : {};
}

function decodeHtml(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&([a-z]+);/gi, (entity, name: string) => namedEntities[name] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

function directResultUrl(rawHref: string) {
  try {
    const decodedHref = decodeHtml(rawHref);
    const resultUrl = new URL(
      decodedHref.startsWith("//") ? `https:${decodedHref}` : decodedHref,
      "https://duckduckgo.com",
    );
    const destination = resultUrl.hostname.endsWith("duckduckgo.com")
      ? resultUrl.searchParams.get("uddg")
      : resultUrl.href;
    if (!destination) return null;
    const parsed = new URL(destination);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function broadenIdentityQuery(query: string) {
  const identity = query.match(
    /^(?:who is|who's|tell me about|look up)\s+@?([a-z0-9_.-]{3,})\??$/i,
  );
  if (!identity) return query;
  const handle = identity[1];
  const compactHandle = handle.replace(/[_.-]/g, "");
  return compactHandle === handle ? handle : `${compactHandle} ${handle}`;
}

function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const resultPattern =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<(?:a|div)[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/gi;

  for (const match of html.matchAll(resultPattern)) {
    const url = directResultUrl(match[1]);
    const title = decodeHtml(match[2]);
    const snippet = decodeHtml(match[3]);
    if (!url || !title || !snippet) continue;
    results.push({ title, url, snippet: snippet.slice(0, 500) });
    if (results.length === 6) break;
  }

  return results;
}

async function researchWeb(query: string) {
  const searchUrl = new URL("https://html.duckduckgo.com/html/");
  searchUrl.searchParams.set("q", broadenIdentityQuery(query));
  const response = await fetch(searchUrl, {
    headers: {
      Accept: "text/html",
      "Accept-Language": "en-IN,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (compatible; SkyAI/1.0; +https://chatgpt.com/)",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Search provider returned ${response.status}`);
  }
  return parseSearchResults(await response.text());
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/research") {
      const corsHeaders = researchResponseHeaders(request);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      if (request.method !== "GET") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405, headers: corsHeaders },
        );
      }
      const query = (url.searchParams.get("q") ?? "").trim().slice(0, 240);
      if (query.length < 2) {
        return Response.json(
          { error: "Enter a longer search query." },
          { status: 400, headers: corsHeaders },
        );
      }
      try {
        const results = await researchWeb(query);
        return Response.json(
          { query, results },
          {
            headers: {
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
              ...corsHeaders,
            },
          },
        );
      } catch (error) {
        console.error("Web research failed", error);
        return Response.json(
          { error: "Live web research is temporarily unavailable." },
          {
            status: 502,
            headers: { "Cache-Control": "no-store", ...corsHeaders },
          },
        );
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
