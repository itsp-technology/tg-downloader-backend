import express, { Request, Response } from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { CONFIG } from "./config.js";
import { parseTelegramLink } from "./utils/linkParser.js";
import { sanitizeFileName } from "./utils/sanitizer.js";
import {
  getClient,
  loadSavedSession,
  saveSessionToDisk,
  deleteSavedSession,
  setPendingAuth,
  getPendingAuth,
} from "./services/telegramClient.js";
import { resolveChannelEntity, findMessageWithMedia } from "./services/metadataService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve static React build files
const clientDistPath = path.resolve(__dirname, "../web/dist");
app.use(express.static(clientDistPath));

// Auth Status
app.get("/api/auth/status", async (_req: Request, res: Response): Promise<any> => {
  try {
    const hasSaved = Boolean(loadSavedSession());
    if (!hasSaved) return res.json({ authorized: false });
    const client = await getClient();
    return res.json({ authorized: await client.isUserAuthorized() });
  } catch {
    return res.json({ authorized: false });
  }
});

// Auth Step 1: Send Telegram Code
app.post("/api/auth/send-code", async (req: Request, res: Response): Promise<any> => {
  try {
    const { apiId, apiHash, phone } = req.body;
    const client = await getClient(Number(apiId), String(apiHash));
    if (await client.isUserAuthorized()) return res.json({ status: "AUTHORIZED" });

    const cleanPhone = String(phone).trim();
    const result = await client.sendCode({ apiId: Number(apiId), apiHash: String(apiHash) }, cleanPhone);
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

// Logout
app.post("/api/auth/logout", async (_req: Request, res: Response): Promise<any> => {
  deleteSavedSession();
  return res.json({ status: "LOGGED_OUT" });
});

// Scan Channel
app.post("/api/media/scan-channel", async (req: Request, res: Response): Promise<any> => {
  try {
    const { link } = req.body;
    const parsed = parseTelegramLink(link);
    if (!parsed) return res.status(400).json({ error: "Invalid Telegram link format." });

    const client = await getClient();
    const entity = await resolveChannelEntity(client, parsed.channelId);
    const channelTitle = (entity as any).title || "Telegram_Channel";

    const combinedMap = new Map<number, any>();
    const options: any = { limit: 10000 };

    if (parsed.messageId) {
      try {
        for await (const m of client.iterMessages(entity, { ...options, replyTo: parsed.messageId })) {
          if (m?.media) combinedMap.set(m.id, m);
        }
      } catch {}
    }

    if (combinedMap.size === 0) {
      for await (const m of client.iterMessages(entity, options)) {
        if (m?.media) combinedMap.set(m.id, m);
      }
    }

    const messages = Array.from(combinedMap.values()).sort((a, b) => a.id - b.id);
    const items = messages.map((msg) => {
      let fileName = `Media_${msg.id}`;
      let fileSize = 0;
      let fileType: "video" | "document" | "zip" | "pdf" | "audio" | "other" = "other";

      if ("document" in msg.media && msg.media.document) {
        const doc = msg.media.document;
        fileSize = Number(doc.size) || 0;
        const attr = doc.attributes?.find((a: any) => a.fileName);
        if (attr?.fileName) fileName = attr.fileName;

        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) fileType = "zip";
        else if (ext === "pdf") fileType = "pdf";
        else if (
          ["mp4", "mkv", "webm", "avi"].includes(ext) ||
          doc.attributes?.some((a: any) => a.className === "DocumentAttributeVideo")
        ) {
          fileType = "video";
          if (!fileName.includes(".")) fileName += ".mp4";
        } else if (["mp3", "m4a", "wav"].includes(ext) || doc.attributes?.some((a: any) => a.className === "DocumentAttributeAudio")) {
          fileType = "audio";
        } else {
          fileType = "document";
        }
      } else if ("photo" in msg.media) {
        fileName = `Photo_${msg.id}.jpg`;
        fileType = "other";
      }

      return {
        id: msg.id,
        fileName: sanitizeFileName(fileName),
        fileSize,
        formattedSize: `${(fileSize / (1024 * 1024)).toFixed(2)} MB`,
        fileType,
        caption: msg.message || "",
        date: new Date((msg.date || 0) * 1000).toLocaleDateString(),
      };
    });

    return res.json({ channelTitle: sanitizeFileName(channelTitle), channelId: parsed.channelId, items });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to scan channel" });
  }
});

// Pass-Through Stream (0 Bytes Server Storage)
// Pass-Through Stream (0 Bytes Server Storage + True Byte Resumption)
app.get("/api/download/stream", async (req: Request, res: Response): Promise<any> => {
  try {
    const { channelId, messageId, offset = 0 } = req.query;
    if (!channelId || !messageId) return res.status(400).send("channelId and messageId required");

    const client = await getClient();
    const entity = await resolveChannelEntity(client, String(channelId));
    const { message: msg } = await findMessageWithMedia(client, entity, Number(messageId));

    if (!msg || !msg.media) return res.status(404).send("Media not found");

    let fileName = `Telegram_File_${messageId}`;
    let fileSize = 0;

    if ("document" in msg.media && msg.media.document) {
      fileSize = Number(msg.media.document.size) || 0;
      const attr = msg.media.document.attributes?.find((a: any) => a.fileName);
      if (attr?.fileName) fileName = attr.fileName;
    } else if ("photo" in msg.media) {
      fileName = `Photo_${messageId}.jpg`;
    }

    const safeName = sanitizeFileName(fileName);
    const startByte = Number(offset) || 0;

    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safeName)}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    if (fileSize > 0) {
      res.setHeader("Content-Length", fileSize - startByte);
    }

    // Stream from Telegram starting from startByte directly to user's browser
    for await (const chunk of client.iterDownload({
      file: msg.media,
      offset: (await import("big-integer")).default(startByte),
      requestSize: 512 * 1024,
    })) {
      if (res.writableEnded || res.closed) break;
      res.write(chunk);
    }

    res.end();
  } catch (err: any) {
    if (!res.headersSent) res.status(500).send(err?.message || "Stream failed");
  }
});

// Express 5 compatible catch-all route for SPA client routing
app.get("/{*splat}", (_req: Request, res: Response) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

const PORT = process.env.PORT || CONFIG.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Telegram Server listening on http://localhost:${PORT}`);
});