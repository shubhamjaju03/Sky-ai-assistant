export type KnowledgeItem = {
  id: string;
  name: string;
  text: string;
  createdAt: number;
};

export type Reminder = {
  id: string;
  title: string;
  dueAt: string;
  createdAt: number;
};

export type SkyBackupPayload = {
  version: 1;
  exportedAt: string;
  messages: unknown[];
  memories: string[];
  knowledge: KnowledgeItem[];
  reminders: Reminder[];
};

export const KNOWLEDGE_KEY = "sky-ai-knowledge-v1";
export const REMINDER_KEY = "sky-ai-reminders-v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function loadKnowledge(): KnowledgeItem[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(KNOWLEDGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is KnowledgeItem =>
          isRecord(item) &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.text === "string" &&
          typeof item.createdAt === "number",
      )
      .slice(-20);
  } catch {
    return [];
  }
}

export function saveKnowledge(items: KnowledgeItem[]) {
  localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(items.slice(-20)));
}

export function loadReminders(): Reminder[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(REMINDER_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is Reminder =>
          isRecord(item) &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          typeof item.dueAt === "string" &&
          Number.isFinite(Date.parse(item.dueAt)) &&
          typeof item.createdAt === "number",
      )
      .slice(-50);
  } catch {
    return [];
  }
}

export function saveReminders(items: Reminder[]) {
  localStorage.setItem(REMINDER_KEY, JSON.stringify(items.slice(-50)));
}

function words(value: string) {
  return new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g)
      ?.filter(
        (word) =>
          !["about", "after", "before", "could", "from", "have", "please", "that", "the", "this", "what", "with", "would"].includes(
            word,
          ),
      ) ?? [],
  );
}

export function relevantKnowledge(prompt: string, items: KnowledgeItem[]) {
  const queryWords = words(prompt);
  const explicitlyRequested = /\b(my|saved|knowledge|library|notes?|documents?|files?)\b/i.test(
    prompt,
  );
  return items
    .map((item) => {
      const haystack = `${item.name} ${item.text}`.toLowerCase();
      let score = 0;
      for (const word of queryWords) {
        if (haystack.includes(word)) score += item.name.toLowerCase().includes(word) ? 3 : 1;
      }
      if (explicitlyRequested) score += 1;
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.item.createdAt - left.item.createdAt)
    .slice(0, 4)
    .map(({ item }) => `${item.name}\n${item.text.slice(0, 4_000)}`);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function backupKey(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: 250_000,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSkyBackup(
  payload: SkyBackupPayload,
  passphrase: string,
) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await backupKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return JSON.stringify({
    format: "sky-encrypted-backup",
    version: 1,
    kdf: "PBKDF2-SHA256-250000",
    cipher: "AES-256-GCM",
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    payload: bytesToBase64(new Uint8Array(encrypted)),
  });
}

export async function decryptSkyBackup(value: string, passphrase: string) {
  const envelope: unknown = JSON.parse(value);
  if (
    !isRecord(envelope) ||
    envelope.format !== "sky-encrypted-backup" ||
    envelope.version !== 1 ||
    typeof envelope.salt !== "string" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.payload !== "string"
  ) {
    throw new Error("This is not a valid Sky backup.");
  }
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const key = await backupKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    base64ToBytes(envelope.payload),
  );
  const payload: unknown = JSON.parse(new TextDecoder().decode(decrypted));
  if (!isRecord(payload) || payload.version !== 1) {
    throw new Error("This Sky backup has an unsupported format.");
  }
  return payload as unknown as SkyBackupPayload;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
