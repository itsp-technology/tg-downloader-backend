import express, { Request, Response } from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const app = express();
app.use(cors());
app.use(express.json());

let sessionString = "";
let client: TelegramClient | null = null;
let currentPhone = "";
let phoneCodeHash = "";

// Global live download progress tracker
let downloadProgress = {
  active: false,
  percentage: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  speed: "0 MB/s",
  fileName: "",
  status: "idle",
};

// Robust link parser supporting direct channel messages and topic links
function parseLink(link: string): { channelId: string; messageId: number } | null {
  const cleanLink = link.trim();

  // Format: https://t.me/c/2869794586/693 or https://t.me/c/2869794586/693/1234
  const privateParts = cleanLink.match(/t\.me\/c\/(\d+)(?:\/\d+)*\/(\d+)/);
  if (privateParts) {
    return {
      channelId: `-100${privateParts[1]}`,
      messageId: parseInt(privateParts[2], 10),
    };
  }

  // Format: https://t.me/channel_name/123
  const publicParts = cleanLink.match(/t\.me\/([^/]+)(?:\/\d+)*\/(\d+)/);
  if (publicParts) {
    return {
      channelId: publicParts[1],
      messageId: parseInt(publicParts[2], 10),
    };
  }

  return null;
}

// 1. Send Login Code
app.post("/api/auth/send-code", async (req: Request, res: Response): Promise<any> => {
  try {
    const { apiId, apiHash, phone } = req.body;
    if (!apiId || !apiHash || !phone) {
      return res.status(400).json({ error: "apiId, apiHash, and phone are required" });
    }

    currentPhone = String(phone).trim();
    const stringSession = new StringSession(sessionString);
    client = new TelegramClient(stringSession, Number(apiId), String(apiHash), {
      connectionRetries: 5,
    });

    await client.connect();

    if (await client.isUserAuthorized()) {
      return res.json({ status: "AUTHORIZED", message: "User already logged in" });
    }

    const result = await client.sendCode(
      {
        apiId: Number(apiId),
        apiHash: String(apiHash),
      },
      currentPhone
    );

    phoneCodeHash = result.phoneCodeHash;
    return res.json({ status: "CODE_SENT", message: "Verification code sent to Telegram" });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to send code" });
  }
});

// 2. Verify Code
app.post("/api/auth/verify-code", async (req: Request, res: Response): Promise<any> => {
  try {
    const { code } = req.body;
    if (!client) return res.status(400).json({ error: "Initialize authentication first" });

    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: currentPhone,
        phoneCodeHash: phoneCodeHash,
        phoneCode: String(code).trim(),
      })
    );

    sessionString = (client.session as StringSession).save();
    return res.json({ status: "SUCCESS", message: "Successfully logged in!" });
  } catch (err: any) {
    if (err?.errorMessage === "SESSION_PASSWORD_NEEDED") {
      return res.json({ status: "2FA_REQUIRED", message: "2-Step verification required" });
    }
    return res.status(400).json({ error: err?.message || "Invalid verification code" });
  }
});

// 3. Verify 2FA
app.post("/api/auth/verify-password", async (req: Request, res: Response): Promise<any> => {
  try {
    const { password } = req.body;
    if (!client) return res.status(400).json({ error: "Client not connected" });

    await (client as any).signInWithPassword({
      password: String(password),
    });

    sessionString = (client.session as StringSession).save();
    return res.json({ status: "SUCCESS", message: "2FA verification successful!" });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Invalid 2FA password" });
  }
});

// 4. Windows Native Folder Picker
app.get("/api/browse-folder", (_req: Request, res: Response): any => {
  const cmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.windows.forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Media Save Directory'; if($f.ShowDialog() -eq 'OK'){ Write-Output $f.SelectedPath }"`;

  exec(cmd, (error, stdout) => {
    if (error) {
      return res.status(500).json({ error: "Failed to open folder browser" });
    }
    const selected = stdout.trim();
    return res.json({ selectedFolder: selected || null });
  });
});

// 5. Download Progress Endpoint
app.get("/api/download-progress", (_req: Request, res: Response): any => {
  return res.json(downloadProgress);
});

// 6. Direct Stream Downloader with Resilient Media Detection
app.post("/api/download", async (req: Request, res: Response): Promise<any> => {
  try {
    const { link, saveFolder } = req.body;
    if (!client || !(await client.isUserAuthorized())) {
      return res.status(401).json({ error: "Session unauthorized. Please log in first." });
    }

    const parsed = parseLink(link);
    if (!parsed) {
      return res.status(400).json({ error: "Invalid Telegram link format." });
    }

    const targetDir = path.resolve(saveFolder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Step A: Resolve Entity
    let entity: any = null;
    try {
      entity = await client.getEntity(parsed.channelId);
    } catch {
      const dialogs = await client.getDialogs({});
      const match = dialogs.find((d) => {
        const idStr = String(d.id);
        return idStr === parsed.channelId || idStr.includes(parsed.channelId.replace("-100", ""));
      });
      if (match) {
        entity = match.entity;
      } else {
        return res.status(404).json({
          error: "Could not access this channel. Ensure your Telegram account is joined to this group/channel.",
        });
      }
    }

    // Step B: Fetch Target Message and Check for Media
    let messages = await client.getMessages(entity, { ids: [parsed.messageId] });
    let targetMsg = messages && messages.length > 0 ? messages[0] : null;

    // Fallback: If link was a topic URL or reply thread anchor without media,
    // search nearby message IDs (+/- 5) for the media message
    if (!targetMsg || !targetMsg.media) {
      console.log(`Message ${parsed.messageId} has no direct media. Checking nearby messages...`);
      const searchRange = [parsed.messageId, parsed.messageId - 1, parsed.messageId + 1, parsed.messageId - 2, parsed.messageId + 2];
      const surrounding = await client.getMessages(entity, { ids: searchRange });
      const foundWithMedia = surrounding.find((m) => m && m.media);
      if (foundWithMedia) {
        targetMsg = foundWithMedia;
      }
    }

    if (!targetMsg || !targetMsg.media) {
      return res.status(400).json({
        error: `No downloadable media found in message ${parsed.messageId}. If this is inside a topic, right click the exact video -> 'Copy Message Link'.`,
      });
    }

    // Step C: Determine Filename & Total Size
    let fileName = `Video_Lecture_${targetMsg.id}.mp4`;
    let totalSize = 0;

    if ("document" in targetMsg.media && (targetMsg.media as any).document) {
      const doc = (targetMsg.media as any).document;
      totalSize = Number(doc.size) || 0;
      const attributes = doc.attributes || [];
      const fileAttr = attributes.find((attr: any) => attr.fileName);
      if (fileAttr && fileAttr.fileName) {
        fileName = fileAttr.fileName;
      }
    } else if ("photo" in targetMsg.media) {
      fileName = `Photo_${targetMsg.id}.jpg`;
    }

    const filePath = path.join(targetDir, fileName);
    const writeStream = fs.createWriteStream(filePath);

    // Initialize live progress tracker
    downloadProgress = {
      active: true,
      percentage: 0,
      downloadedBytes: 0,
      totalBytes: totalSize,
      speed: "0 MB/s",
      fileName: fileName,
      status: "Downloading...",
    };

    let lastTime = Date.now();
    let lastBytes = 0;

    // Step D: Stream download in chunks to avoid Node.js RAM limits
    for await (const chunk of client.iterDownload({
      file: targetMsg.media,
      requestSize: 1024 * 512, // 512 KB chunks for smooth high-speed streaming
    })) {
      writeStream.write(chunk);
      downloadProgress.downloadedBytes += chunk.length;

      const now = Date.now();
      const timeDiff = (now - lastTime) / 1000;
      if (timeDiff >= 1) {
        const bytesDiff = downloadProgress.downloadedBytes - lastBytes;
        downloadProgress.speed = `${(bytesDiff / (1024 * 1024 * timeDiff)).toFixed(2)} MB/s`;
        lastBytes = downloadProgress.downloadedBytes;
        lastTime = now;
      }

      if (totalSize > 0) {
        downloadProgress.percentage = Math.min(
          100,
          Math.round((downloadProgress.downloadedBytes / totalSize) * 100)
        );
      }
    }

    await new Promise((resolve) => writeStream.end(resolve));

    downloadProgress = {
      active: false,
      percentage: 100,
      downloadedBytes: totalSize,
      totalBytes: totalSize,
      speed: "0 MB/s",
      fileName: fileName,
      status: "Completed",
    };

    return res.json({
      status: "SUCCESS",
      filePath: filePath,
      message: `Downloaded successfully to ${filePath}`,
    });
  } catch (err: any) {
    downloadProgress.active = false;
    downloadProgress.status = "Failed";
    return res.status(500).json({ error: err?.message || "Download failed" });
  }
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Node/TypeScript API running on http://localhost:${PORT}`);
});