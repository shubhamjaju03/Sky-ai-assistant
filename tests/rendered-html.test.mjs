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
  assert.match(html, /Private memory/);
  assert.match(html, /READY INSTANTLY/);
  assert.match(html, />ONLINE</);
  assert.match(html, /No model download/);
  assert.doesNotMatch(html, /Preparing your private AI|Loading Free AI|Enable Free AI/);
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

test("chat endpoint keeps the Gemini key server-side and returns an online reply", async () => {
  const worker = await loadWorker("chat");
  const originalFetch = globalThis.fetch;
  let providerUrl = "";
  let providerKey = "";
  globalThis.fetch = async (input, init) => {
    providerUrl = String(input);
    providerKey = new Headers(init?.headers).get("x-goog-api-key") ?? "";
    return Response.json({
      candidates: [
        {
          content: { parts: [{ text: "Online reply" }] },
        },
      ],
    });
  };

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello Sky" }],
          memories: [],
          sources: [],
        }),
      }),
      {
        ASSETS: {
          fetch: async () => new Response("Not found", { status: 404 }),
        },
        GEMINI_API_KEY: "test-server-key",
      },
      {
        waitUntil() {},
        passThroughOnException() {},
      },
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.match(
      providerUrl,
      /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.1-flash-lite:generateContent/,
    );
    assert.equal(providerKey, "test-server-key");
    assert.equal(payload.answer, "Online reply");
    assert.equal(payload.model, "gemini-3.1-flash-lite");
    assert.doesNotMatch(JSON.stringify(payload), /test-server-key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat endpoint returns only explicitly requested, validated task actions", async () => {
  const worker = await loadWorker("action");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: "create_text_file",
                  args: {
                    filename: "../sky-note.txt",
                    content: "TASK_READY",
                  },
                },
              },
            ],
          },
        },
      ],
    });

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: "Create a text file named sky-note.txt containing TASK_READY",
            },
          ],
        }),
      }),
      {
        ASSETS: {
          fetch: async () => new Response("Not found", { status: 404 }),
        },
        GEMINI_API_KEY: "test-server-key",
      },
      {
        waitUntil() {},
        passThroughOnException() {},
      },
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload.actions, [
      {
        type: "create_text_file",
        filename: "_sky-note.txt",
        content: "TASK_READY",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
