"use client";

import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MLCEngine } from "@mlc-ai/web-llm";

type Role = "assistant" | "user";

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  pending?: boolean;
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
const CHAT_KEY = "sky-ai-chat-v1";
const MEMORY_KEY = "sky-ai-memory-v1";
const MODEL_NOTE = "about 500 MB once, then cached on this device";

const STARTER_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  createdAt: Date.now(),
  content:
    "Hey — I’m Sky. I can chat, remember details, read text files, take voice input, speak answers, calculate, and work privately on this device. Enable Free AI once to begin.",
};

const QUICK_PROMPTS = [
  "Plan my day",
  "Explain something",
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
  >("idle");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("Free AI is not loaded");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [memoryCount, setMemoryCount] = useState(0);
  const engineRef = useRef<MLCEngine | null>(null);
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
    if (engineRef.current || modelState === "loading") return;
    const hasWebGpu = "gpu" in navigator;
    if (!hasWebGpu) {
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
    if (modelState === "loading") return;

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
    const searchMatch = visibleText.match(/^\/?search(?: the web for)?\s+(.+)/i);
    if (searchMatch) {
      window.open(
        `https://duckduckgo.com/?q=${encodeURIComponent(searchMatch[1])}`,
        "_blank",
        "noopener,noreferrer",
      );
      addAssistant(`I opened a private web search for “${searchMatch[1]}”.`);
      return;
    }

    const engine = engineRef.current;
    if (!engine || modelState !== "ready") {
      addAssistant(
        `Tap “Enable Free AI” first. It downloads ${MODEL_NOTE}; after that, chats run locally with no token charges.`,
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
              "You are Sky, a warm, capable personal AI assistant. Be concise, practical, and honest. Never claim to have used the internet unless the user used the search command. The user's on-device memories are: " +
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
            <span>Chats stay on this device</span>
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
                  Conversations and memories stay on your device. No account, no
                  token meter, no per-message bill.
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
                disabled={!input.trim() || modelState === "loading"}
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
