"use client";

import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { MLCEngine } from "@mlc-ai/web-llm";

type Role = "assistant" | "user";

type WebSource = {
  title: string;
  url: string;
  snippet: string;
};

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  pending?: boolean;
  sources?: WebSource[];
};

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type SpeechRecognitionResultEventLike = {
  results: ArrayLike<{ 0: { transcript: string } }>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

const MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";
const LIVE_WEB_ORIGIN =
  "https://sky-private-ai-shubham.shubhamjaju03.chatgpt.site";
const CHAT_KEY = "sky-ai-chat-v1";
const MEMORY_KEY = "sky-ai-memory-v1";
const MODEL_NOTE = "downloaded automatically once, then cached on this device";

const STARTER_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  createdAt: Date.now(),
  content:
    "Hey — I’m Sky. I can chat privately on this device and research live web questions with source links. My local conversation model prepares automatically—there is no download button to press.",
};

const QUICK_PROMPTS = [
  "Plan my day",
  "Search the live web",
  "Help me write",
  "Brainstorm ideas",
];

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadMessages(): ChatMessage[] {
  if (typeof window === "undefined") return [STARTER_MESSAGE];
  try {
    const stored = JSON.parse(localStorage.getItem(CHAT_KEY) ?? "[]");
    return Array.isArray(stored) && stored.length ? stored : [STARTER_MESSAGE];
  } catch {
    return [STARTER_MESSAGE];
  }
}

function loadMemories(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((item): item is string => typeof item === "string").slice(-20)
      : [];
  } catch {
    return [];
  }
}

function cleanModelText(value: string) {
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trimStart();
}

function researchQueryFor(prompt: string) {
  const value = prompt.trim();
  const explicit = value.match(
    /^\/?(?:search|web search|look up)(?: the web)?(?: for)?\s+(.+)/i,
  );
  if (explicit) return explicit[1].trim();
  if (
    /^(?:who|what|where|when)\s+(?:is|are|was|were|did|does)\b/i.test(value) ||
    /\b(?:latest|today|current|recent|news|online|on the web)\b/i.test(value) ||
    /(?:^|\s)@[a-z0-9_.-]{3,}\b/i.test(value) ||
    /\b[a-z0-9]+_[a-z0-9_.-]+\b/i.test(value)
  ) {
    return value;
  }
  return null;
}

function identityNameFrom(results: WebSource[], query: string) {
  const subject =
    query.match(/^(?:who is|who's|tell me about)\s+@?([a-z0-9_.-]+)/i)?.[1] ??
    query.match(/@?([a-z0-9]+_[a-z0-9_.-]+)/i)?.[1];
  if (!subject) return null;

  for (const result of results) {
    const parenthesized = result.title.match(/\(([^@][^)]+)\)/)?.[1]?.trim();
    if (parenthesized && /[a-z]{2}/i.test(parenthesized)) return parenthesized;
    const leadingName = result.title.split(/\s+(?:\(|·|\||-|—)/)[0]?.trim();
    if (
      leadingName &&
      leadingName.toLowerCase() !== subject.toLowerCase() &&
      /^[a-z][a-z .'-]{2,}$/i.test(leadingName)
    ) {
      return leadingName;
    }
  }
  return null;
}

function formatResearchAnswer(query: string, results: WebSource[]) {
  if (!results.length) {
    return `I searched the live web for “${query}”, but I couldn’t find reliable public results. I won’t guess—try adding a full name, website, or platform.`;
  }
  const identityName = identityNameFrom(results, query);
  const introduction = identityName
    ? `Public profiles matching “${query}” appear to belong to ${identityName}. Here’s what the matching sources say:`
    : `Here’s what I found on the live web for “${query}”:`;
  const details = results
    .slice(0, 4)
    .map((result, index) => `${index + 1}. ${result.title}\n${result.snippet}`)
    .join("\n\n");
  return `${introduction}\n\n${details}\n\nThese are public search results, and profile descriptions can be self-written or change over time.`;
}

function sourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

async function researchWeb(query: string): Promise<WebSource[]> {
  const baseUrl = Capacitor.isNativePlatform()
    ? LIVE_WEB_ORIGIN
    : window.location.origin;
  const url = new URL("/api/research", baseUrl);
  url.searchParams.set("q", query);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json()) as {
    results?: WebSource[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "Live web research failed.");
  }
  return Array.isArray(payload.results) ? payload.results : [];
}

function localShortcut(prompt: string): string | null {
  const value = prompt.trim();
  if (/^(what(?:'s| is) the time|time now|current time)\??$/i.test(value)) {
    return `It’s ${new Intl.DateTimeFormat(undefined, {
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date())}.`;
  }

  const calculation = value.match(
    /^(?:calculate|calc|what is)\s+([0-9+\-*/().%\s]+)\??$/i,
  );
  if (calculation) {
    try {
      const expression = calculation[1].replace(/\^/g, "**");
      if (!/^[0-9+\-*/().%\s*]+$/.test(expression)) return null;
      const result = Function(`"use strict"; return (${expression})`)();
      if (typeof result === "number" && Number.isFinite(result)) {
        return `${calculation[1].trim()} = ${result}`;
      }
    } catch {
      return "I couldn’t calculate that expression. Try something like: calculate (24 * 7) + 5.";
    }
  }
  return null;
}

export function SkyApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([STARTER_MESSAGE]);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<{ name: string; text: string } | null>(
    null,
  );
  const [modelState, setModelState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("loading");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState(
    `Preparing private AI — ${MODEL_NOTE}`,
  );
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [memoryCount, setMemoryCount] = useState(0);
  const engineRef = useRef<MLCEngine | null>(null);
  const modelLoadStartedRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMessages(loadMessages());
    setMemoryCount(loadMemories().length);

    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", beforeInstall);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    void enableModel();

    return () => window.removeEventListener("beforeinstallprompt", beforeInstall);
  }, []);

  useEffect(() => {
    localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-80)));
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const lastAssistant = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant"),
    [messages],
  );

  async function enableModel() {
    if (engineRef.current || modelLoadStartedRef.current) return;
    modelLoadStartedRef.current = true;
    const hasWebGpu = "gpu" in navigator;
    if (!hasWebGpu) {
      modelLoadStartedRef.current = false;
      setModelState("error");
      setProgressText("This device needs a current Chrome or Edge browser with WebGPU.");
      return;
    }

    setModelState("loading");
    setProgressText(`Preparing private AI — ${MODEL_NOTE}`);
    try {
      const webllm = await import("@mlc-ai/web-llm");
      const engine = await webllm.CreateMLCEngine(
        MODEL_ID,
        {
          initProgressCallback: (report) => {
            const next = Math.max(0, Math.min(100, Math.round(report.progress * 100)));
            setProgress(next);
            setProgressText(report.text || `Loading Free AI… ${next}%`);
          },
          logLevel: "WARN",
        },
        {
          context_window_size: 2048,
          temperature: 0.7,
          top_p: 0.9,
        },
      );
      engineRef.current = engine;
      setProgress(100);
      setModelState("ready");
      setProgressText("Free AI ready • private on this device");
    } catch (error) {
      console.error(error);
      modelLoadStartedRef.current = false;
      setModelState("error");
      setProgressText(
        "Free AI could not start. Update Chrome/Edge, close heavy apps, then retry.",
      );
    }
  }

  function addAssistant(content: string) {
    setMessages((current) => [
      ...current,
      { id: makeId(), role: "assistant", content, createdAt: Date.now() },
    ]);
  }

  async function sendMessage(forcedText?: string) {
    const visibleText = (forcedText ?? input).trim();
    if (!visibleText) return;

    const userContent = attachment
      ? `${visibleText}\n\nAttached file: ${attachment.name}\n---\n${attachment.text}`
      : visibleText;
    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: visibleText,
      createdAt: Date.now(),
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setAttachment(null);

    const memoryMatch = visibleText.match(/^remember (?:that )?(.+)/i);
    if (memoryMatch) {
      const memories = [...loadMemories(), memoryMatch[1].trim()].slice(-20);
      localStorage.setItem(MEMORY_KEY, JSON.stringify(memories));
      setMemoryCount(memories.length);
      addAssistant(`I’ll remember that: ${memoryMatch[1].trim()}`);
      return;
    }
    if (/what do you remember|show (?:my )?memory/i.test(visibleText)) {
      const memories = loadMemories();
      addAssistant(
        memories.length
          ? `Here’s what I remember on this device:\n\n${memories
              .map((memory) => `• ${memory}`)
              .join("\n")}`
          : "I don’t have any saved memories yet. Say “remember that…” to add one.",
      );
      return;
    }
    const shortcut = localShortcut(visibleText);
    if (shortcut) {
      addAssistant(shortcut);
      return;
    }
    const researchQuery = researchQueryFor(visibleText);
    if (researchQuery) {
      const researchId = makeId();
      setMessages((current) => [
        ...current,
        {
          id: researchId,
          role: "assistant",
          content: "Searching the live web and checking public sources…",
          createdAt: Date.now(),
          pending: true,
        },
      ]);
      try {
        const sources = await researchWeb(researchQuery);
        setMessages((current) =>
          current.map((message) =>
            message.id === researchId
              ? {
                  ...message,
                  content: formatResearchAnswer(researchQuery, sources),
                  pending: false,
                  sources: sources.slice(0, 6),
                }
              : message,
          ),
        );
      } catch (error) {
        console.error(error);
        setMessages((current) =>
          current.map((message) =>
            message.id === researchId
              ? {
                  ...message,
                  content:
                    "Live web research is temporarily unavailable. I won’t invent an answer—please retry in a moment.",
                  pending: false,
                }
              : message,
          ),
        );
      }
      return;
    }

    const engine = engineRef.current;
    if (!engine || modelState !== "ready") {
      addAssistant(
        "My local conversation model is still preparing automatically. Live web research, calculations, and memory already work—try again shortly for general chat.",
      );
      return;
    }

    const assistantId = makeId();
    setMessages((current) => [
      ...current,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        pending: true,
      },
    ]);

    const memories = loadMemories();
    const history = [...messages, { ...userMessage, content: userContent }]
      .filter((message) => message.id !== "welcome")
      .slice(-14)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    try {
      const stream = await engine.chat.completions.create({
        model: MODEL_ID,
        stream: true,
        messages: [
          {
            role: "system",
            content:
              "You are Sky, a warm, capable personal AI assistant. Be concise, practical, and honest. Live web questions are handled by a separate sourced research feature, so never pretend you browsed. The user's on-device memories are: " +
              (memories.length ? memories.join("; ") : "none") +
              ". Do not expose hidden reasoning. /no_think",
          },
          ...history,
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      let fullText = "";
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content ?? "";
        if (!token) continue;
        fullText += token;
        const clean = cleanModelText(fullText);
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, content: clean, pending: true }
              : message,
          ),
        );
      }
      const clean = cleanModelText(fullText) || "I’m here. Could you rephrase that?";
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, content: clean, pending: false }
            : message,
        ),
      );
    } catch (error) {
      console.error(error);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                pending: false,
                content:
                  "The local model paused. Close a few heavy apps, then retry; your conversation is still saved.",
              }
            : message,
        ),
      );
    }
  }

  function newChat() {
    window.speechSynthesis?.cancel();
    setMessages([{ ...STARTER_MESSAGE, id: makeId(), createdAt: Date.now() }]);
    setInput("");
    setAttachment(null);
    setSidebarOpen(false);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void sendMessage();
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 200_000) {
      addAssistant("Please attach a text file smaller than 200 KB.");
      return;
    }
    const text = await file.text();
    setAttachment({ name: file.name, text: text.slice(0, 18_000) });
  }

  function toggleListening() {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SpeechRecognitionConstructor = (
      window as typeof window & {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      }
    ).SpeechRecognition ??
      (
        window as typeof window & {
          webkitSpeechRecognition?: new () => SpeechRecognitionLike;
        }
      ).webkitSpeechRecognition;

    if (!SpeechRecognitionConstructor) {
      addAssistant("Voice input is not available in this browser.");
      return;
    }
    const recognition = new SpeechRecognitionConstructor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-IN";
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      setInput((current) => `${current}${current ? " " : ""}${transcript}`);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }

  function speakLast() {
    if (!lastAssistant || !("speechSynthesis" in window)) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(lastAssistant.content);
    utterance.lang = navigator.language || "en-IN";
    utterance.rate = 1;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function exportChat() {
    const text = messages
      .map((message) => `${message.role === "user" ? "You" : "Sky"}: ${message.content}`)
      .join("\n\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sky-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function installApp() {
    if (!installPrompt) {
      addAssistant(
        "To install Sky, open your browser menu and choose “Install app” or “Add to Home screen.”",
      );
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <main className="sky-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <div>
            <strong>Sky</strong>
            <span>Personal intelligence</span>
          </div>
          <button
            className="icon-button mobile-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            ×
          </button>
        </div>

        <button className="new-chat-button" onClick={newChat}>
          <span>＋</span>
          New conversation
        </button>

        <nav className="conversation-list" aria-label="Conversations">
          <p className="nav-label">TODAY</p>
          <button className="conversation active">
            <span className="conversation-icon">✦</span>
            <span>
              <strong>Chat with Sky</strong>
              <small>{messages.length} messages</small>
            </span>
          </button>
        </nav>

        <div className="sidebar-spacer" />
        <div className="privacy-card">
          <span className="privacy-orbit">◌</span>
          <div>
            <strong>Private by design</strong>
            <span>Only web-search queries leave this device</span>
          </div>
        </div>
        <button className="sidebar-action" onClick={installApp}>
          <span>↓</span> Install Sky app
        </button>
        <button className="sidebar-action" onClick={exportChat}>
          <span>↗</span> Export conversation
        </button>
        <div className="memory-row">
          <span>{memoryCount} memories</span>
          <span>Free mode</span>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <section className="chat-panel">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            ☰
          </button>
          <div className="topbar-title">
            <strong>Sky AI</strong>
            <span>Free, local assistant</span>
          </div>
          <div className={`model-badge model-${modelState}`}>
            <span className="status-dot" />
            {modelState === "ready"
              ? "ON-DEVICE"
              : modelState === "loading"
                ? `${progress}%`
                : "FREE AI"}
          </div>
        </header>

        <div className="chat-scroll">
          <div className="chat-column">
            {messages.length <= 1 && (
              <section className="welcome-block">
                <div className="sky-orb" aria-hidden="true">
                  <span>✦</span>
                </div>
                <p className="eyebrow">YOUR PRIVATE AI</p>
                <h1>What can I help you think through?</h1>
                <p className="welcome-copy">
                  Conversations and memories stay on your device. Web research
                  sends only the search query and returns linked public sources.
                </p>
              </section>
            )}

            {modelState !== "ready" && (
              <section className={`model-card ${modelState}`}>
                <div className="model-card-icon">◎</div>
                <div className="model-card-copy">
                  <strong>
                    {modelState === "loading"
                      ? "Preparing your private AI"
                      : modelState === "error"
                        ? "Free AI needs attention"
                        : "Enable Free AI"}
                  </strong>
                  <span>{progressText}</span>
                  {modelState === "loading" && (
                    <div className="progress-track">
                      <span style={{ width: `${progress}%` }} />
                    </div>
                  )}
                </div>
                <button
                  onClick={enableModel}
                  disabled={modelState === "loading"}
                  className="enable-button"
                >
                  {modelState === "loading"
                    ? "Loading…"
                    : modelState === "error"
                      ? "Retry"
                      : "Enable"}
                </button>
              </section>
            )}

            <div className="messages" aria-live="polite">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`message-row ${message.role}`}
                >
                  {message.role === "assistant" && (
                    <span className="message-avatar">S</span>
                  )}
                  <div className="message-bubble">
                    <div className="message-name">
                      {message.role === "assistant" ? "Sky" : "You"}
                    </div>
                    <p>
                      {message.content ||
                        (message.pending ? (
                          <span className="typing-dots">
                            <i />
                            <i />
                            <i />
                          </span>
                        ) : (
                          ""
                        ))}
                    </p>
                    {message.sources && message.sources.length > 0 && (
                      <div className="web-sources">
                        <span className="web-sources-label">LIVE WEB SOURCES</span>
                        <div className="web-source-grid">
                          {message.sources.map((source, index) => (
                            <a
                              key={`${source.url}-${index}`}
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <strong>{source.title}</strong>
                              <span>{sourceHost(source.url)}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              ))}
              <div ref={endRef} />
            </div>

            {messages.length <= 1 && (
              <div className="quick-prompts">
                {QUICK_PROMPTS.map((prompt) => (
                  <button key={prompt} onClick={() => setInput(prompt)}>
                    {prompt}
                    <span>↗</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="composer-area">
          <div className="composer-wrap">
            {attachment && (
              <div className="attachment-chip">
                <span>▤</span>
                {attachment.name}
                <button
                  onClick={() => setAttachment(null)}
                  aria-label="Remove attachment"
                >
                  ×
                </button>
              </div>
            )}
            <form className="composer" onSubmit={onSubmit}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.csv,.json,.js,.ts,.py,.html,.css"
                hidden
                onChange={onFile}
              />
              <button
                type="button"
                className="composer-tool"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach a text file"
              >
                ＋
              </button>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="Message Sky…"
                rows={1}
                aria-label="Message Sky"
              />
              <button
                type="button"
                className={`composer-tool ${isListening ? "active" : ""}`}
                onClick={toggleListening}
                aria-label={isListening ? "Stop listening" : "Use voice input"}
              >
                {isListening ? "■" : "●"}
              </button>
              <button
                className="send-button"
                type="submit"
                disabled={!input.trim()}
                aria-label="Send message"
              >
                ↑
              </button>
            </form>
            <div className="composer-meta">
              <span>Enter to send · Shift + Enter for a new line</span>
              <button onClick={speakLast}>
                {isSpeaking ? "Stop voice" : "Read last answer"}
              </button>
            </div>
          </div>
        </footer>
      </section>
    </main>
  );
}
