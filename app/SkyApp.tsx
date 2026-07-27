"use client";

import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  decryptSkyBackup,
  downloadBlob,
  encryptSkyBackup,
  loadKnowledge,
  loadReminders,
  relevantKnowledge,
  saveKnowledge,
  saveReminders,
  type Reminder,
  type SkyBackupPayload,
} from "./sky-utils";

type Role = "assistant" | "user";

type WebSource = {
  title: string;
  url: string;
  snippet: string;
};

type AssistantAction =
  | { type: "open_website"; url: string }
  | { type: "create_text_file"; filename: string; content: string }
  | { type: "copy_text"; text: string }
  | { type: "compose_email"; to?: string; subject: string; body: string }
  | { type: "create_reminder"; title: string; dueAt: string }
  | {
      type: "create_calendar_event";
      title: string;
      startAt: string;
      endAt: string;
      description?: string;
      location?: string;
    }
  | { type: "share_text"; title?: string; text: string; url?: string }
  | { type: "open_map"; query: string };

type FileAttachment = {
  name: string;
  mimeType: string;
  text?: string;
  data?: string;
};

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  pending?: boolean;
  sources?: WebSource[];
  attachmentName?: string;
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

const LIVE_WEB_ORIGIN =
  "https://sky-private-ai-shubham.shubhamjaju03.chatgpt.site";
const CHAT_KEY = "sky-ai-chat-v1";
const MEMORY_KEY = "sky-ai-memory-v1";
const HANDS_FREE_KEY = "sky-ai-hands-free-v1";

const STARTER_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  createdAt: Date.now(),
  content:
    "Hey — I’m Sky. I can research the live web, understand images and PDFs, learn from your private knowledge library, schedule reminders, prepare calendar events, use voice, and perform safe task actions. Everything starts instantly with no model download.",
};

const QUICK_PROMPTS = [
  "Set a reminder for tomorrow",
  "Plan a calendar event",
  "Search the latest news",
  "Analyze an attached image",
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

function researchQueryFor(prompt: string) {
  const value = prompt.trim();
  const explicit = value.match(
    /^\/?(?:search|web search|look up)(?: the web)?(?: for)?\s+(.+)/i,
  );
  if (explicit) return explicit[1].trim();
  if (
    /^(?:who|what|where|when)\s+(?:is|are|was|were|did|does)\b/i.test(value) ||
    /\b(?:latest|today|current|recent|news|weather|price|score|on the web)\b/i.test(
      value,
    ) ||
    /(?:^|\s)@[a-z0-9_.-]{3,}\b/i.test(value) ||
    /\b[a-z0-9]+_[a-z0-9_.-]+\b/i.test(value)
  ) {
    return value;
  }
  return null;
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

async function chatOnline(
  messages: Array<{ role: Role; content: string }>,
  memories: string[],
  sources: WebSource[],
  knowledge: string[],
  attachment: FileAttachment | null,
) {
  const baseUrl = Capacitor.isNativePlatform()
    ? LIVE_WEB_ORIGIN
    : window.location.origin;
  const response = await fetch(new URL("/api/chat", baseUrl), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      memories,
      sources,
      knowledge,
      attachment,
      locale: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
  const payload = (await response.json()) as {
    answer?: string;
    actions?: AssistantAction[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "Online AI is temporarily unavailable.");
  }
  return {
    answer: payload.answer || "I’m here. Could you rephrase that?",
    actions: Array.isArray(payload.actions) ? payload.actions : [],
  };
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function calendarDate(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
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
  const [attachment, setAttachment] = useState<FileAttachment | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [memoryCount, setMemoryCount] = useState(0);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const [reminderCount, setReminderCount] = useState(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      setMessages([{ ...STARTER_MESSAGE, id: makeId(), createdAt: Date.now() }]);
    } else {
      setMessages(loadMessages());
    }
    const shared = [params.get("title"), params.get("text"), params.get("url")]
      .filter(Boolean)
      .join("\n");
    const shortcutPrompt = params.get("prompt");
    if (shared) setInput(`Help me with this shared content:\n${shared}`);
    else if (shortcutPrompt) setInput(shortcutPrompt.slice(0, 1_000));
    setMemoryCount(loadMemories().length);
    setKnowledgeCount(loadKnowledge().length);
    const reminders = loadReminders();
    setReminderCount(reminders.filter((reminder) => Date.parse(reminder.dueAt) > Date.now()).length);
    setHandsFree(localStorage.getItem(HANDS_FREE_KEY) === "true");
    reminders.forEach((reminder) => scheduleWebNotification(reminder, false));

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

  useEffect(() => {
    localStorage.setItem(HANDS_FREE_KEY, String(handsFree));
  }, [handsFree]);

  const lastAssistant = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant"),
    [messages],
  );

  function addAssistant(content: string) {
    setMessages((current) => [
      ...current,
      { id: makeId(), role: "assistant", content, createdAt: Date.now() },
    ]);
  }

  async function sendMessage(forcedText?: string) {
    const visibleText = (forcedText ?? input).trim();
    if (!visibleText || isThinking) return;

    const currentAttachment = attachment;
    const userContent = currentAttachment
      ? `${visibleText}\n\nAttached file: ${currentAttachment.name} (${currentAttachment.mimeType})`
      : visibleText;
    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: visibleText,
      createdAt: Date.now(),
      attachmentName: currentAttachment?.name,
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
    if (
      currentAttachment?.text &&
      /\b(save|add|store|learn)\b[\s\S]{0,50}\b(knowledge|library|file|document|notes?)\b/i.test(
        visibleText,
      )
    ) {
      const knowledge = [
        ...loadKnowledge(),
        {
          id: makeId(),
          name: currentAttachment.name,
          text: currentAttachment.text.slice(0, 25_000),
          createdAt: Date.now(),
        },
      ].slice(-20);
      saveKnowledge(knowledge);
      setKnowledgeCount(knowledge.length);
      addAssistant(
        `Saved “${currentAttachment.name}” to your private knowledge library on this device.`,
      );
      return;
    }
    if (
      /(?:\b(?:show|list|what(?:'s| is) in)\b[\s\S]{0,30}\bknowledge\b|\bknowledge library\b)/i.test(
        visibleText,
      )
    ) {
      const knowledge = loadKnowledge();
      addAssistant(
        knowledge.length
          ? `Your private knowledge library:\n\n${knowledge
              .map((item) => `• ${item.name}`)
              .join("\n")}`
          : "Your knowledge library is empty. Attach a text file and say “save this to my knowledge library.”",
      );
      return;
    }
    if (/^(?:show|list)\s+(?:my\s+)?reminders?\??$/i.test(visibleText)) {
      const reminders = loadReminders()
        .filter((reminder) => Date.parse(reminder.dueAt) > Date.now())
        .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt));
      addAssistant(
        reminders.length
          ? `Your upcoming reminders:\n\n${reminders
              .map((reminder) => `• ${displayDate(reminder.dueAt)} — ${reminder.title}`)
              .join("\n")}`
          : "You don’t have any upcoming reminders.",
      );
      return;
    }

    const assistantId = makeId();
    setIsThinking(true);
    setMessages((current) => [
      ...current,
      {
        id: assistantId,
        role: "assistant",
        content: researchQueryFor(visibleText)
          ? "Checking live sources…"
          : "",
        createdAt: Date.now(),
        pending: true,
      },
    ]);

    const memories = loadMemories();
    const knowledge = relevantKnowledge(visibleText, loadKnowledge());
    const history = [...messages, { ...userMessage, content: userContent }]
      .filter((message) => message.id !== "welcome")
      .slice(-14)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    let sources: WebSource[] = [];
    try {
      const researchQuery = researchQueryFor(visibleText);
      if (researchQuery) {
        try {
          sources = await researchWeb(researchQuery);
        } catch (error) {
          console.warn("Live research unavailable; continuing with online AI.", error);
        }
      }
      const result = await chatOnline(
        history,
        memories,
        sources,
        knowledge,
        currentAttachment,
      );
      const actionNotes = await runActions(result.actions);
      const content = actionNotes.length
        ? `${result.answer}\n\n${actionNotes.join("\n")}`
        : result.answer;
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content,
                pending: false,
                sources: sources.slice(0, 6),
              }
            : message,
        ),
      );
      if (handsFree) speakText(result.answer);
    } catch (error) {
      console.error(error);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
              ? {
                  ...message,
                  pending: false,
                  content:
                    error instanceof Error
                      ? error.message
                      : "Online AI is temporarily unavailable. Please try again.",
                }
              : message,
          ),
        );
    } finally {
      setIsThinking(false);
    }
  }

  async function runActions(actions: AssistantAction[]) {
    const notes: string[] = [];
    for (const action of actions.slice(0, 5)) {
      if (action.type === "open_website") {
        const anchor = document.createElement("a");
        anchor.href = action.url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.click();
        notes.push(`✓ Opened ${action.url}`);
      } else if (action.type === "create_text_file") {
        const blob = new Blob([action.content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = action.filename;
        anchor.click();
        URL.revokeObjectURL(url);
        notes.push(`✓ Created ${action.filename}`);
      } else if (action.type === "copy_text") {
        try {
          await navigator.clipboard.writeText(action.text);
          notes.push("✓ Copied to your clipboard");
        } catch {
          notes.push("Clipboard permission was blocked by the browser.");
        }
      } else if (action.type === "compose_email") {
        const params = new URLSearchParams({
          subject: action.subject,
          body: action.body,
        });
        window.location.href = `mailto:${encodeURIComponent(action.to ?? "")}?${params}`;
        notes.push("✓ Opened an email draft for your review");
      } else if (action.type === "create_reminder") {
        notes.push(await createReminder(action.title, action.dueAt));
      } else if (action.type === "create_calendar_event") {
        openCalendarEvent(action);
        notes.push(`✓ Opened “${action.title}” in Google Calendar for your review`);
      } else if (action.type === "share_text") {
        if (navigator.share) {
          await navigator.share({
            title: action.title,
            text: action.text,
            url: action.url,
          });
          notes.push("✓ Opened your device’s share sheet");
        } else {
          await navigator.clipboard.writeText(
            [action.text, action.url].filter(Boolean).join("\n"),
          );
          notes.push("✓ Sharing is unavailable here, so I copied it instead");
        }
      } else if (action.type === "open_map") {
        const url = new URL("https://www.google.com/maps/search/");
        url.searchParams.set("api", "1");
        url.searchParams.set("query", action.query);
        const anchor = document.createElement("a");
        anchor.href = url.href;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.click();
        notes.push(`✓ Opened Maps for “${action.query}”`);
      }
    }
    return notes;
  }

  function scheduleWebNotification(reminder: Reminder, askPermission: boolean) {
    if (
      Capacitor.isNativePlatform() ||
      !("Notification" in window) ||
      Date.parse(reminder.dueAt) <= Date.now()
    ) {
      return false;
    }
    const schedule = async () => {
      let permission = Notification.permission;
      if (permission === "default" && askPermission) {
        permission = await Notification.requestPermission();
      }
      if (permission !== "granted") return;
      const delay = Date.parse(reminder.dueAt) - Date.now();
      if (delay > 0 && delay <= 2_147_000_000) {
        window.setTimeout(
          () => new Notification("Sky reminder", { body: reminder.title }),
          delay,
        );
      }
    };
    void schedule();
    return true;
  }

  async function createReminder(title: string, dueAt: string) {
    const reminder: Reminder = {
      id: makeId(),
      title,
      dueAt,
      createdAt: Date.now(),
    };
    const reminders = [...loadReminders(), reminder].slice(-50);
    saveReminders(reminders);
    setReminderCount(
      reminders.filter((item) => Date.parse(item.dueAt) > Date.now()).length,
    );

    if (Capacitor.isNativePlatform()) {
      try {
        const { LocalNotifications } = await import(
          "@capacitor/local-notifications"
        );
        let permission = await LocalNotifications.checkPermissions();
        if (permission.display !== "granted") {
          permission = await LocalNotifications.requestPermissions();
        }
        if (permission.display === "granted") {
          const id =
            (Math.abs(
              [...reminder.id].reduce(
                (hash, character) =>
                  ((hash << 5) - hash + character.charCodeAt(0)) | 0,
                0,
              ),
            ) %
              2_147_483_647) ||
            1;
          await LocalNotifications.schedule({
            notifications: [
              {
                id,
                title: "Sky reminder",
                body: reminder.title,
                schedule: { at: new Date(reminder.dueAt) },
              },
            ],
          });
          return `✓ Reminder scheduled for ${displayDate(reminder.dueAt)}`;
        }
      } catch (error) {
        console.warn("Native notification scheduling failed.", error);
      }
    } else {
      scheduleWebNotification(reminder, true);
      return `✓ Reminder saved for ${displayDate(reminder.dueAt)}. Keep the installed web app available for browser notifications.`;
    }

    return `✓ Reminder saved for ${displayDate(reminder.dueAt)}. Notification permission is off.`;
  }

  function openCalendarEvent(
    action: Extract<AssistantAction, { type: "create_calendar_event" }>,
  ) {
    const url = new URL("https://calendar.google.com/calendar/render");
    url.searchParams.set("action", "TEMPLATE");
    url.searchParams.set("text", action.title);
    url.searchParams.set(
      "dates",
      `${calendarDate(action.startAt)}/${calendarDate(action.endAt)}`,
    );
    if (action.description) url.searchParams.set("details", action.description);
    if (action.location) url.searchParams.set("location", action.location);
    const anchor = document.createElement("a");
    anchor.href = url.href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
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
    const textLike =
      file.type.startsWith("text/") ||
      /\.(txt|md|csv|json|js|ts|py|html|css)$/i.test(file.name);
    const supportedBinary = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ]);
    if (!textLike && !supportedBinary.has(file.type)) {
      addAssistant(
        "I can currently read images (JPG, PNG, WebP), PDFs, and text/code files.",
      );
      return;
    }
    if (textLike) {
      if (file.size > 250_000) {
        addAssistant("Please attach a text or code file smaller than 250 KB.");
        return;
      }
      const text = await file.text();
      setAttachment({
        name: file.name,
        mimeType: file.type || "text/plain",
        text: text.slice(0, 25_000),
      });
      return;
    }
    if (file.size > 2_500_000) {
      addAssistant("Please attach an image or PDF smaller than 2.5 MB.");
      return;
    }
    setAttachment({
      name: file.name,
      mimeType: file.type,
      data: await fileToBase64(file),
    });
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

  function speakText(text: string) {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || "en-IN";
    utterance.rate = 1;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function speakLast() {
    if (!lastAssistant || !("speechSynthesis" in window)) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    speakText(lastAssistant.content);
  }

  function exportChat() {
    const text = messages
      .map((message) => `${message.role === "user" ? "You" : "Sky"}: ${message.content}`)
      .join("\n\n");
    downloadBlob(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
      `sky-chat-${new Date().toISOString().slice(0, 10)}.txt`,
    );
  }

  async function backupSkyData() {
    const passphrase = window.prompt(
      "Create a password for this encrypted Sky backup. You will need it to restore on another device.",
    );
    if (!passphrase) return;
    if (passphrase.length < 8) {
      addAssistant("Use a backup password with at least 8 characters.");
      return;
    }
    const payload: SkyBackupPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      messages: messages.slice(-80),
      memories: loadMemories(),
      knowledge: loadKnowledge(),
      reminders: loadReminders(),
    };
    const encrypted = await encryptSkyBackup(payload, passphrase);
    downloadBlob(
      new Blob([encrypted], { type: "application/json" }),
      `sky-encrypted-${new Date().toISOString().slice(0, 10)}.skybackup`,
    );
    addAssistant(
      "Encrypted backup created. Keep the file and its password safe; Sky never stores that password.",
    );
  }

  async function restoreSkyData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const passphrase = window.prompt("Enter the password for this Sky backup.");
    if (!passphrase) return;
    try {
      const payload = await decryptSkyBackup(await file.text(), passphrase);
      const restoredMessages = Array.isArray(payload.messages)
        ? payload.messages.filter((item): item is ChatMessage => {
            if (!item || typeof item !== "object") return false;
            const candidate = item as Partial<ChatMessage>;
            return (
              (candidate.role === "assistant" || candidate.role === "user") &&
              typeof candidate.content === "string"
            );
          })
        : [];
      localStorage.setItem(
        CHAT_KEY,
        JSON.stringify(restoredMessages.length ? restoredMessages.slice(-80) : [STARTER_MESSAGE]),
      );
      localStorage.setItem(
        MEMORY_KEY,
        JSON.stringify(Array.isArray(payload.memories) ? payload.memories.slice(-20) : []),
      );
      saveKnowledge(Array.isArray(payload.knowledge) ? payload.knowledge : []);
      saveReminders(Array.isArray(payload.reminders) ? payload.reminders : []);
      setMessages(loadMessages());
      setMemoryCount(loadMemories().length);
      setKnowledgeCount(loadKnowledge().length);
      setReminderCount(
        loadReminders().filter((reminder) => Date.parse(reminder.dueAt) > Date.now())
          .length,
      );
      addAssistant("Encrypted Sky data restored on this device.");
      setSidebarOpen(false);
    } catch {
      addAssistant("I couldn’t restore that backup. Check the file and password.");
    }
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
          <span className="brand-mark" aria-hidden="true" />
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
            <strong>Private memory</strong>
            <span>Memories stay here; AI prompts use secure online processing</span>
          </div>
        </div>
        <button className="sidebar-action" onClick={installApp}>
          <span>↓</span> Install Sky app
        </button>
        <button className="sidebar-action" onClick={exportChat}>
          <span>↗</span> Export conversation
        </button>
        <button className="sidebar-action" onClick={() => void backupSkyData()}>
          <span>⌁</span> Encrypted backup
        </button>
        <input
          ref={backupInputRef}
          type="file"
          accept=".skybackup,application/json"
          hidden
          onChange={(event) => void restoreSkyData(event)}
        />
        <button
          className="sidebar-action"
          onClick={() => backupInputRef.current?.click()}
        >
          <span>⇣</span> Restore on this device
        </button>
        <div className="memory-row">
          <span>{memoryCount} memories</span>
          <span>{knowledgeCount} files</span>
          <span>{reminderCount} reminders</span>
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
            <span>Multimodal agent · private memory · live web</span>
          </div>
          <div className="model-badge model-ready">
            <span className="status-dot" />
            ONLINE
          </div>
        </header>

        <div className="chat-scroll">
          <div className="chat-column">
            {messages.length <= 1 && (
              <section className="welcome-block">
                <div className="sky-orb" aria-hidden="true">
                  <span>✦</span>
                </div>
                <p className="eyebrow">READY INSTANTLY</p>
                <h1>What can I help you think through?</h1>
                <p className="welcome-copy">
                  Ask, research, attach a photo or PDF, set reminders, create
                  calendar events, or use your private knowledge. No model
                  download or paid subscription is required.
                </p>
              </section>
            )}

            <div className="messages" aria-live="polite">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`message-row ${message.role}`}
                >
                  {message.role === "assistant" && (
                    <span className="message-avatar" aria-hidden="true" />
                  )}
                  <div className="message-bubble">
                    <div className="message-name">
                      {message.role === "assistant" ? "Sky" : "You"}
                    </div>
                    {message.attachmentName && (
                      <span className="message-attachment">
                        ▤ {message.attachmentName}
                      </span>
                    )}
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
                accept="image/jpeg,image/png,image/webp,application/pdf,.txt,.md,.csv,.json,.js,.ts,.py,.html,.css"
                hidden
                onChange={onFile}
              />
              <button
                type="button"
                className="composer-tool"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach an image, PDF, or text file"
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
                disabled={!input.trim() || isThinking}
                aria-label="Send message"
              >
                ↑
              </button>
            </form>
            <div className="composer-meta">
              <span>Images · PDFs · voice · reminders · private knowledge</span>
              <div>
                <button
                  className={handsFree ? "active-text" : ""}
                  onClick={() => setHandsFree((current) => !current)}
                >
                  {handsFree ? "Auto-voice on" : "Auto-voice"}
                </button>
                <button onClick={speakLast}>
                  {isSpeaking ? "Stop voice" : "Read answer"}
                </button>
              </div>
            </div>
          </div>
        </footer>
      </section>
    </main>
  );
}
