import fs from "node:fs";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { CONFIG } from "../config.js";

let clientInstance: TelegramClient | null = null;
let currentPhone = "";
let phoneCodeHash = "";

export function loadSavedSession(): string {
  if (fs.existsSync(CONFIG.SESSION_FILE)) {
    return fs.readFileSync(CONFIG.SESSION_FILE, "utf-8").trim();
  }
  return "";
}

export function saveSessionToDisk(sessionStr: string): void {
  fs.writeFileSync(CONFIG.SESSION_FILE, sessionStr, "utf-8");
}

export function deleteSavedSession(): void {
  if (fs.existsSync(CONFIG.SESSION_FILE)) {
    fs.unlinkSync(CONFIG.SESSION_FILE);
  }
  clientInstance = null;
}

export async function getClient(apiId?: number, apiHash?: string): Promise<TelegramClient> {
  if (clientInstance) return clientInstance;

  const savedSession = loadSavedSession();
  const session = new StringSession(savedSession);

  // If no credentials supplied, fallback to environment or defaults
  const id = apiId || Number(process.env.TG_API_ID) || 0;
  const hash = apiHash || process.env.TG_API_HASH || "";

  clientInstance = new TelegramClient(session, id, hash, {
    connectionRetries: 5,
  });

  await clientInstance.connect();
  return clientInstance;
}

export function setPendingAuth(phone: string, hash: string) {
  currentPhone = phone;
  phoneCodeHash = hash;
}

export function getPendingAuth() {
  return { phone: currentPhone, hash: phoneCodeHash };
}