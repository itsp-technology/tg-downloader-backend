import { TelegramClient } from "telegram";
import { formatBytes, formatDuration, sanitizeFileName } from "../utils/sanitizer.js";

export interface MediaPreview {
  channelTitle: string;
  messageId: number;
  fileName: string;
  fileSize: number;
  formattedSize: string;
  duration: number;
  formattedDuration: string;
  caption: string;
  hasMedia: boolean;
  thumbnailBase64: string | null;
}

export async function resolveChannelEntity(client: TelegramClient, channelId: string | number): Promise<any> {
  try {
    return await client.getEntity(channelId);
  } catch {
    const dialogs = await client.getDialogs({});
    const match = dialogs.find((d) => {
      const idStr = String(d.id);
      return idStr === String(channelId) || idStr.includes(String(channelId).replace("-100", ""));
    });
    if (match) return match.entity;
    throw new Error(`Cannot access channel ${channelId}. Make sure you have joined this group/channel.`);
  }
}

export async function findMessageWithMedia(
  client: TelegramClient,
  entity: any,
  targetId: number
): Promise<{ message: any; resolvedId: number }> {
  // 1. First, check the direct message ID
  const directMessages = await client.getMessages(entity, { ids: [targetId] });
  let msg = directMessages && directMessages.length > 0 ? directMessages[0] : null;

  if (msg && msg.media) {
    return { message: msg, resolvedId: targetId };
  }

  // 2. If it's a topic header without media, search for replies inside this topic (replyToMsgId = targetId)
  try {
    const topicReplies = await client.getMessages(entity, {
      replyTo: targetId,
      limit: 10,
    });
    const mediaMsg = topicReplies.find((m) => m && m.media);
    if (mediaMsg) {
      return { message: mediaMsg, resolvedId: mediaMsg.id };
    }
  } catch {
    // ReplyTo search may not be supported on all supergroups, fallback to sequential range scan
  }

  // 3. Sequential search forward (+1 to +15): In topics, video messages typically follow immediately
  const forwardRange = Array.from({ length: 15 }, (_, i) => targetId + 1 + i);
  const scanMessages = await client.getMessages(entity, { ids: forwardRange });
  const found = scanMessages.find((m) => m && m.media);
  if (found) {
    return { message: found, resolvedId: found.id };
  }

  return { message: msg, resolvedId: targetId };
}

export async function getMessageMetadata(
  client: TelegramClient,
  channelId: string | number,
  messageId: number
): Promise<MediaPreview> {
  const entity = await resolveChannelEntity(client, channelId);
  const channelTitle = (entity as any).title || "Telegram_Channel";

  const { message: msg, resolvedId } = await findMessageWithMedia(client, entity, messageId);

  if (!msg || !msg.media) {
    return {
      channelTitle: sanitizeFileName(channelTitle),
      messageId,
      fileName: "",
      fileSize: 0,
      formattedSize: "0 B",
      duration: 0,
      formattedDuration: "00:00",
      caption: msg?.message || "No media found in topic header or neighboring messages",
      hasMedia: false,
      thumbnailBase64: null,
    };
  }

  let fileName = `Lecture_${resolvedId}`;
  let fileSize = 0;
  let duration = 0;

  if ("document" in msg.media && (msg.media as any).document) {
    const doc = (msg.media as any).document;
    fileSize = Number(doc.size) || 0;
    const attributes = doc.attributes || [];

    const fileAttr = attributes.find((a: any) => a.fileName);
    if (fileAttr && fileAttr.fileName) {
      fileName = fileAttr.fileName;
    }

    const videoAttr = attributes.find((a: any) => a.className === "DocumentAttributeVideo");
    if (videoAttr) {
      duration = videoAttr.duration || 0;
      if (!fileName.includes(".")) fileName += ".mp4";
    }
  } else if ("photo" in msg.media) {
    fileName = `Photo_${resolvedId}.jpg`;
  }

  // Extract thumbnail if available
  let thumbnailBase64: string | null = null;
  try {
    const thumbBuffer = await client.downloadMedia(msg, { thumb: 0 });
    if (thumbBuffer && Buffer.isBuffer(thumbBuffer)) {
      thumbnailBase64 = `data:image/jpeg;base64,${thumbBuffer.toString("base64")}`;
    }
  } catch {
    // Thumbnails are optional
  }

  return {
    channelTitle: sanitizeFileName(channelTitle),
    messageId: resolvedId, // Return the actual media message ID
    fileName: sanitizeFileName(fileName),
    fileSize,
    formattedSize: formatBytes(fileSize),
    duration,
    formattedDuration: formatDuration(duration),
    caption: msg.message || "",
    hasMedia: true,
    thumbnailBase64,
  };
}