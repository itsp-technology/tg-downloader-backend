import express, { Request, Response } from "express";
import cors from "cors";
import { Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { CONFIG } from "./config.js";
import { parseTelegramLink } from "./utils/linkParser.js";
import { openFolderPicker, openInExplorer } from "./utils/system.js";
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

// Check current authorization status on startup
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

// Step 1: Send Telegram Code
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

// Step 2: Verify Code
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

// Step 3: Verify 2FA
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

// Logout: Wipes saved session from disk
app.post("/api/auth/logout", async (_req: Request, res: Response): Promise<any> => {
  deleteSavedSession();
  return res.json({ status: "LOGGED_OUT" });
});

// Native folder browse dialog
app.get("/api/system/browse-folder", async (_req: Request, res: Response): Promise<any> => {
  const selected = await openFolderPicker();
  return res.json({ selectedFolder: selected });
});

// Open folder in Windows File Explorer
app.post("/api/system/open-explorer", (req: Request, res: Response): any => {
  const { folderPath } = req.body;
  if (folderPath) openInExplorer(folderPath);
  return res.json({ status: "OK" });
});

// Preview metadata before download
app.post("/api/media/preview", async (req: Request, res: Response): Promise<any> => {
  try {
    const { link } = req.body;
    const parsed = parseTelegramLink(link);
    if (!parsed) return res.status(400).json({ error: "Invalid Telegram link format." });

    const client = await getClient();
    const preview = await getMessageMetadata(client, parsed.channelId, parsed.messageId);
    return res.json(preview);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to fetch metadata" });
  }
});

// Fetch last 30 video messages from a channel (Channel Video Browser)
app.post("/api/media/channel-videos", async (req: Request, res: Response): Promise<any> => {
  try {
    const { link } = req.body;
    const parsed = parseTelegramLink(link);
    if (!parsed) return res.status(400).json({ error: "Invalid link format." });

    const client = await getClient();
    const entity = await resolveChannelEntity(client, parsed.channelId);
    const messages = await client.getMessages(entity, { limit: 30 });

    const videoList = messages
      .filter((m) => m.media && "document" in m.media)
      .map((m) => {
        const doc = (m.media as any).document;
        const attr = doc.attributes?.find((a: any) => a.fileName);
        return {
          id: m.id,
          fileName: attr?.fileName || `Lecture_${m.id}.mp4`,
          size: doc.size,
          caption: m.message?.slice(0, 80) || "",
        };
      });

    return res.json({ videos: videoList });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to inspect channel" });
  }
});

// Enqueue Single or Batch Downloads (Supports Range: startId -> endId)
app.post("/api/download/enqueue", async (req: Request, res: Response): Promise<any> => {
  try {
    const { link, saveFolder, endMessageId } = req.body;
    const parsed = parseTelegramLink(link);
    if (!parsed) return res.status(400).json({ error: "Invalid link format." });

    const client = await getClient();
    const startId = parsed.messageId;
    const endId = endMessageId ? Number(endMessageId) : startId;

    const addedItems = [];
    for (let id = startId; id <= endId; id++) {
      const meta = await getMessageMetadata(client, parsed.channelId, id);
      if (meta.hasMedia) {
        const item = queueManager.addToQueue({
          id: `${parsed.channelId}_${id}`,
          channelId: parsed.channelId,
          messageId: id,
          channelTitle: meta.channelTitle,
          fileName: meta.fileName,
          targetFolder: saveFolder,
          totalBytes: meta.fileSize,
        });
        addedItems.push(item);
      }
    }

    // Begin background processing loop
    queueManager.startProcessing(client);
    return res.json({ status: "ENQUEUED", count: addedItems.length, items: addedItems });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to enqueue items" });
  }
});

// Polling live progress
app.get("/api/download/queue-status", (_req: Request, res: Response): any => {
  return res.json(queueManager.getQueue());
});

// Pause current active download
app.post("/api/download/pause", (_req: Request, res: Response): any => {
  queueManager.pauseCurrent();
  return res.json({ status: "PAUSED" });
});

app.listen(CONFIG.PORT, () => {
  console.log(`Telegram Modular Service listening on http://localhost:${CONFIG.PORT}`);
});