import fs from "node:fs";
import path from "node:path";
import { TelegramClient } from "telegram";
import bigInt from "big-integer";
import { CONFIG } from "../config.js";
import { sanitizeFileName } from "../utils/sanitizer.js";
import { resolveChannelEntity, findMessageWithMedia } from "./metadataService.js";

export interface QueueItem {
  id: string;
  channelId: string | number;
  messageId: number;
  channelTitle: string;
  fileName: string;
  targetFolder: string;
  totalBytes: number;
  downloadedBytes: number;
  percentage: number;
  speed: string;
  eta: string;
  status: "pending" | "downloading" | "paused" | "completed" | "error";
  error?: string;
}

class DownloadQueueManager {
  private queue: QueueItem[] = [];
  private isProcessing = false;
  private shouldPauseCurrent = false;

  public addToQueue(item: Omit<QueueItem, "downloadedBytes" | "percentage" | "speed" | "eta" | "status">): QueueItem {
    const newItem: QueueItem = {
      ...item,
      downloadedBytes: 0,
      percentage: 0,
      speed: "0 MB/s",
      eta: "--",
      status: "pending",
    };
    this.queue.push(newItem);
    return newItem;
  }

  public getQueue(): QueueItem[] {
    return this.queue;
  }

  public pauseCurrent(): void {
    this.shouldPauseCurrent = true;
  }

  public async startProcessing(client: TelegramClient): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (true) {
      const pendingItem = this.queue.find((i) => i.status === "pending");
      if (!pendingItem) break;

      this.shouldPauseCurrent = false;
      await this.downloadItem(client, pendingItem);
    }

    this.isProcessing = false;
  }

  private async downloadItem(client: TelegramClient, item: QueueItem): Promise<void> {
    item.status = "downloading";

    const finalDir = path.join(item.targetFolder, sanitizeFileName(item.channelTitle));
    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }

    const targetFilePath = path.join(finalDir, sanitizeFileName(item.fileName));

    let startOffset = 0;
    if (fs.existsSync(targetFilePath)) {
      startOffset = fs.statSync(targetFilePath).size;
      if (item.totalBytes > 0 && startOffset >= item.totalBytes) {
        item.status = "completed";
        item.downloadedBytes = item.totalBytes;
        item.percentage = 100;
        return;
      }
    }

    item.downloadedBytes = startOffset;
    const writeStream = fs.createWriteStream(targetFilePath, { flags: startOffset > 0 ? "a" : "w" });

    try {
      const entity = await resolveChannelEntity(client, item.channelId);
      const { message: msg } = await findMessageWithMedia(client, entity, item.messageId);

      if (!msg || !msg.media) throw new Error("No media located in message or topic thread.");

      let lastTime = Date.now();
      let lastBytes = item.downloadedBytes;

      for await (const chunk of client.iterDownload({
        file: msg.media,
        offset: bigInt(startOffset),
        requestSize: CONFIG.CHUNK_SIZE,
      })) {
        if (this.shouldPauseCurrent) {
          item.status = "paused";
          writeStream.end();
          return;
        }

        writeStream.write(chunk);
        item.downloadedBytes += chunk.length;

        const now = Date.now();
        const elapsedSec = (now - lastTime) / 1000;
        if (elapsedSec >= CONFIG.SPEED_SAMPLE_INTERVAL_SEC) {
          const bytesDiff = item.downloadedBytes - lastBytes;
          const bytesPerSec = bytesDiff / elapsedSec;
          item.speed = `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;

          const remainingBytes = item.totalBytes - item.downloadedBytes;
          if (bytesPerSec > 0 && remainingBytes > 0) {
            const secLeft = Math.round(remainingBytes / bytesPerSec);
            const mins = Math.floor(secLeft / 60);
            const secs = secLeft % 60;
            item.eta = `${mins}m ${secs}s`;
          }

          lastBytes = item.downloadedBytes;
          lastTime = now;
        }

        if (item.totalBytes > 0) {
          item.percentage = Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100));
        }
      }

      await new Promise((res) => writeStream.end(res));
      item.status = "completed";
      item.percentage = 100;
      item.eta = "Done";
      item.speed = "0 MB/s";
    } catch (err: any) {
      writeStream.end();
      item.status = "error";
      item.error = err?.message || "Stream interrupted";
    }
  }
}

export const queueManager = new DownloadQueueManager();