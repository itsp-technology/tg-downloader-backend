import { TelegramClient, Api } from "telegram";
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
  // 1. Direct getEntity check
  try {
    return await client.getEntity(channelId);
  } catch {
    // If it's a public username (string without "-100"), auto-join the channel
    if (typeof channelId === "string" && !channelId.startsWith("-100")) {
      try {
        await client.invoke(new Api.channels.JoinChannel({ channel: channelId }));
        return await client.getEntity(channelId);
      } catch {
        // Fallback continues below
      }
    }
  }

  // 2. Search local dialogs list
  const dialogs = await client.getDialogs({});
  const cleanTarget = String(channelId).replace(/^-100/, "");

  const match = dialogs.find((d) => {
    const idStr = String(d.id).replace(/^-100/, "");
    const username = (d.entity as any)?.username;
    return idStr === cleanTarget || (username && username.toLowerCase() === String(channelId).toLowerCase());
  });

  if (match) return match.entity;

  throw new Error(`Cannot access channel '${channelId}'. If this is a private channel, make sure you have joined it in Telegram first.`);
}

export async function findMessageWithMedia(
  client: TelegramClient,
  entity: any,
  targetId: number
): Promise<{ message: any; resolvedId: number }> {
  // 1. Check direct message ID
  const directMessages = await client.getMessages(entity, { ids: [targetId] });
  let msg = directMessages && directMessages.length > 0 ? directMessages[0] : null;

  if (msg && msg.media) {
    return { message: msg, resolvedId: targetId };
  }

  // 2. Search replies inside topic (replyToMsgId = targetId)
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
    // Fallback continues
  }

  // 3. Sequential search forward (+1 to +15)
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
      caption: msg?.message || "No media found",
      hasMedia: false,
      thumbnailBase64: null,
    };
  }

  let fileName = `Media_${resolvedId}`;
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

  let thumbnailBase64: string | null = null;
  try {
    const thumbBuffer = await client.downloadMedia(msg, { thumb: 0 });
    if (thumbBuffer && Buffer.isBuffer(thumbBuffer)) {
      thumbnailBase64 = `data:image/jpeg;base64,${thumbBuffer.toString("base64")}`;
    }
  } catch {
    // optional thumbnail
  }

  return {
    channelTitle: sanitizeFileName(channelTitle),
    messageId: resolvedId,
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