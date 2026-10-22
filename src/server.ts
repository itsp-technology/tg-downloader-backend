import express, { Request, Response } from "express";
import cors from "cors";
import { Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { CONFIG } from "./config.js";
import { parseTelegramLink } from "./utils/linkParser.js";
import { openFolderPicker, openInExplorer } from "./utils/system.js";
import { formatBytes, sanitizeFileName } from "./utils/sanitizer.js";
import {
  getClient,
  loadSavedSession,
  saveSessionToDisk,
  deleteSavedSession,
  setPendingAuth,
  getPendingAuth,
} from "./services/telegramClient.js";
import { getMessageMetadata, resolveChannelEntity } from "./services/metadataService.js";
import { queueManager } from "./services/downloadQueue.js";

const app = express();
app.use(cors());
app.use(express.json());

// Helper: Stream messages across Telegram channel history
async function collectAllMediaMessages(
  client: any,
  entity: any,
  filter?: any,
  replyToMsgId?: number,
  maxScan: number = 10000
): Promise<any[]> {
  const results: any[] = [];
  const options: any = { limit: maxScan };

  if (filter) options.filter = filter;
  if (replyToMsgId) options.replyTo = replyToMsgId;

  for await (const message of client.iterMessages(entity, options)) {
    if (message && message.media) {
      results.push(message);
    }
  }

  return results;
}

// Check current authorization status
app.get("/api/auth/status", async (_req: Request, res: Response): Promise<any> => {
  try {
    const hasSaved = Boolean(loadSavedSession());
    if (!hasSaved) return res.json({ authorized: false });

    const client = await getClient();
    const isAuth = await client.isUserAuthorized();
    return res.json({ authorized: isAuth });
  } catch {
    return res.json({ authorized: false });
  }
});

// Auth Step 1: Send Telegram Code
app.post("/api/auth/send-code", async (req: Request, res: Response): Promise<any> => {
  try {
    const { apiId, apiHash, phone } = req.body;
    const client = await getClient(Number(apiId), String(apiHash));

    if (await client.isUserAuthorized()) {
      return res.json({ status: "AUTHORIZED" });
    }

    const cleanPhone = String(phone).trim();
    const result = await client.sendCode(
      { apiId: Number(apiId), apiHash: String(apiHash) },
      cleanPhone
    );

    setPendingAuth(cleanPhone, result.phoneCodeHash);
    return res.json({ status: "CODE_SENT" });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to send code" });
  }
});

// Auth Step 2: Verify Code
app.post("/api/auth/verify-code", async (req: Request, res: Response): Promise<any> => {
  try {
    const { code } = req.body;
    const client = await getClient();
    const { phone, hash } = getPendingAuth();

    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash: hash,
        phoneCode: String(code).trim(),
      })
    );

    const sessionStr = (client.session as StringSession).save();
    saveSessionToDisk(sessionStr);
    return res.json({ status: "SUCCESS" });
  } catch (err: any) {
    if (err?.errorMessage === "SESSION_PASSWORD_NEEDED") {
      return res.json({ status: "2FA_REQUIRED" });
    }
    return res.status(400).json({ error: err?.message || "Verification failed" });
  }
});

// Auth Step 3: Verify 2FA
app.post("/api/auth/verify-password", async (req: Request, res: Response): Promise<any> => {
  try {
    const { password } = req.body;
    const client = await getClient();
    await (client as any).signInWithPassword({ password: String(password) });

    const sessionStr = (client.session as StringSession).save();
    saveSessionToDisk(sessionStr);
    return res.json({ status: "SUCCESS" });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Invalid 2FA password" });
  }
});

// Auth Logout
app.post("/api/auth/logout", async (_req: Request, res: Response): Promise<any> => {
  deleteSavedSession();
  return res.json({ status: "LOGGED_OUT" });
});

// System utilities
app.get("/api/system/browse-folder", async (_req: Request, res: Response): Promise<any> => {
  const selected = await openFolderPicker();
  return res.json({ selectedFolder: selected });
});

app.post("/api/system/open-explorer", (req: Request, res: Response): any => {
  const { folderPath } = req.body;
  if (folderPath) openInExplorer(folderPath);
  return res.json({ status: "OK" });
});

// Scan Channel or Topic with Top-to-Bottom Telegram Order (Ascending ID: a.id - b.id)
app.post("/api/media/scan-channel", async (req: Request, res: Response): Promise<any> => {
  try {
    const { link } = req.body;
    const parsed = parseTelegramLink(link);
    if (!parsed) return res.status(400).json({ error: "Invalid Telegram link format." });

    const client = await getClient();
    const entity = await resolveChannelEntity(client, parsed.channelId);
    const channelTitle = (entity as any).title || "Telegram_Channel";

    const combinedMap = new Map<number, any>();

    if (parsed.messageId) {
      try {
        const topicMessages = await collectAllMediaMessages(client, entity, undefined, parsed.messageId);
        for (const m of topicMessages) {
          if (m && m.id) combinedMap.set(m.id, m);
        }
      } catch {
        // Fallback continues
      }
    }

    if (combinedMap.size === 0) {
      try {
        const [videos, documents] = await Promise.all([
          collectAllMediaMessages(client, entity, new Api.InputMessagesFilterVideo()),
          collectAllMediaMessages(client, entity, new Api.InputMessagesFilterDocument()),
        ]);

        for (const m of [...videos, ...documents]) {
          if (m && m.id) combinedMap.set(m.id, m);
        }
      } catch (err: any) {
        console.warn("Filtered iterator error, performing raw scan:", err?.message);
        const rawMessages = await collectAllMediaMessages(client, entity);
        for (const m of rawMessages) {
          if (m && m.id) combinedMap.set(m.id, m);
        }
      }
    }

    // Sort ASCENDING (a.id - b.id) so older lectures appear at the top, newer at the bottom, matching Telegram order
    const messages = Array.from(combinedMap.values()).sort((a, b) => a.id - b.id);

    const items = [];
    for (const msg of messages) {
      if (!msg || !msg.media) continue;

      let fileName = `Media_${msg.id}`;
      let fileSize = 0;
      let fileType: "video" | "document" | "zip" | "pdf" | "audio" | "other" = "other";

      if ("document" in msg.media && (msg.media as any).document) {
        const doc = (msg.media as any).document;
        fileSize = Number(doc.size) || 0;
        const attributes = doc.attributes || [];

        const fileAttr = attributes.find((a: any) => a.fileName);
        if (fileAttr && fileAttr.fileName) {
          fileName = fileAttr.fileName;
        }

        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
          fileType = "zip";
        } else if (ext === "pdf") {
          fileType = "pdf";
        } else if (
          ["mp4", "mkv", "avi", "mov", "webm"].includes(ext) ||
          attributes.some((a: any) => a.className === "DocumentAttributeVideo")
        ) {
          fileType = "video";
          if (!fileName.includes(".")) fileName += ".mp4";
        } else if (
          ["mp3", "m4a", "flac", "wav", "ogg"].includes(ext) ||
          attributes.some((a: any) => a.className === "DocumentAttributeAudio")
        ) {
          fileType = "audio";
        } else {
          fileType = "document";
        }
      } else if ("photo" in msg.media) {
        fileName = `Photo_${msg.id}.jpg`;
        fileType = "other";
      }

      items.push({
        id: msg.id,
        fileName: sanitizeFileName(fileName),
        fileSize,
        formattedSize: formatBytes(fileSize),
        fileType,
        caption: msg.message || "",
        date: new Date((msg.date || 0) * 1000).toLocaleDateString(),
      });
    }

    return res.json({
      channelTitle: sanitizeFileName(channelTitle),
      channelId: parsed.channelId,
      items,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to scan channel media" });
  }
});

// Enqueue Selected Items from Checkboxes
app.post("/api/download/enqueue-selected", async (req: Request, res: Response): Promise<any> => {
  try {
    const { channelId, saveFolder, selectedIds } = req.body;
    if (!channelId || !selectedIds || !Array.isArray(selectedIds) || selectedIds.length === 0) {
      return res.status(400).json({ error: "Please select at least one item to download." });
    }

    const client = await getClient();
    const addedItems = [];

    for (const msgId of selectedIds) {
      const meta = await getMessageMetadata(client, channelId, Number(msgId));
      if (meta.hasMedia) {
        const item = queueManager.addToQueue({
          id: `${channelId}_${msgId}`,
          channelId,
          messageId: Number(msgId),
          channelTitle: meta.channelTitle,
          fileName: meta.fileName,
          targetFolder: saveFolder,
          totalBytes: meta.fileSize,
        });
        addedItems.push(item);
      }
    }

    queueManager.startProcessing(client);
    return res.json({ status: "ENQUEUED", count: addedItems.length, items: addedItems });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to enqueue selected items" });
  }
});

// Stop / Pause active download
app.post("/api/download/stop", (_req: Request, res: Response): any => {
  queueManager.stopCurrent();
  return res.json({ status: "STOPPED" });
});

// Resume paused download
app.post("/api/download/resume", async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.body;
    const client = await getClient();
    const success = queueManager.resumeItem(id, client);
    return res.json({ status: success ? "RESUMED" : "CANNOT_RESUME" });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to resume" });
  }
});

// Live Queue status
app.get("/api/download/queue-status", (_req: Request, res: Response): any => {
  return res.json(queueManager.getQueue());
});

app.listen(CONFIG.PORT, () => {
  console.log(`Telegram Modular Service listening on http://localhost:${CONFIG.PORT}`);
});