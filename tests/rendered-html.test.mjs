import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker(label) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${label}-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

async function render() {
  const worker = await loadWorker("render");
  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Sky AI application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Sky AI/);
  assert.match(html, /Private by design/);
  assert.match(html, /Preparing your private AI/);
  assert.match(html, /Loading…/);
  assert.match(html, /manifest\.webmanifest/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("research endpoint returns public sources for an identity query", async () => {
  const worker = await loadWorker("research");
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(`
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fshubham&amp;rut=test">
          Shubham Jaju (@shubham_jaju03) · Example
        </a>
        <a class="result__snippet" href="#">
          Software developer and community manager.
        </a>
      </div>
    `);
  };

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/research?q=who%20is%20shubham_jaju03"),
      {
        ASSETS: {
          fetch: async () => new Response("Not found", { status: 404 }),
        },
      },
      {
        waitUntil() {},
        passThroughOnException() {},
      },
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.match(requestedUrl, /shubhamjaju03/);
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].title, "Shubham Jaju (@shubham_jaju03) · Example");
    assert.equal(payload.results[0].url, "https://example.com/shubham");
    assert.equal(payload.results[0].snippet, "Software developer and community manager.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
