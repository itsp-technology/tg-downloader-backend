export interface ParsedLink {
  channelId: string | number;
  messageId: number | null; // null when the link is a root channel link
}

export function parseTelegramLink(link: string): ParsedLink | null {
  if (!link) return null;
  const clean = link.trim().replace(/\/+$/, ""); // strip trailing slashes

  // 1. Telegram Web format with Message or Topic ID:
  // e.g., https://web.telegram.org/a/#-1003641059847_18 or #-1003641059847/18
  const webWithMsg = clean.match(/web\.telegram\.org\/[ak]\/#-?(\d+)[_/](\d+)/);
  if (webWithMsg) {
    const rawId = webWithMsg[1].startsWith("100") ? webWithMsg[1] : `100${webWithMsg[1]}`;
    return {
      channelId: `-100${rawId.replace(/^-100/, "")}`,
      messageId: parseInt(webWithMsg[2], 10),
    };
  }

  // 2. Telegram Web Root Channel format (NO message ID):
  // e.g., https://web.telegram.org/a/#-1003802851567 or https://web.telegram.org/k/#-1003802851567
  const webRoot = clean.match(/web\.telegram\.org\/[ak]\/#-?(\d+)/);
  if (webRoot) {
    const rawId = webRoot[1].startsWith("100") ? webRoot[1] : `100${webRoot[1]}`;
    return {
      channelId: `-100${rawId.replace(/^-100/, "")}`,
      messageId: null,
    };
  }

  // 3. Private /c/ format with Message ID:
  // e.g., https://t.me/c/3641059847/18 or https://t.me/c/2869794586/595
  const privateWithMsg = clean.match(/t\.me\/c\/(\d+)(?:\/\d+)*\/(\d+)/);
  if (privateWithMsg) {
    return {
      channelId: `-100${privateWithMsg[1]}`,
      messageId: parseInt(privateWithMsg[2], 10),
    };
  }

  // 4. Private /c/ Root Channel (NO message ID):
  // e.g., https://t.me/c/3641059847
  const privateRoot = clean.match(/t\.me\/c\/(\d+)/);
  if (privateRoot) {
    return {
      channelId: `-100${privateRoot[1]}`,
      messageId: null,
    };
  }

  // 5. Public channel with message ID:
  // e.g., https://t.me/NareshItCoursesFree/125
  const publicWithMsg = clean.match(/t\.me\/([a-zA-Z0-9_]{4,})(?:\/\d+)*\/(\d+)/);
  if (publicWithMsg && publicWithMsg[1].toLowerCase() !== "c") {
    return {
      channelId: publicWithMsg[1],
      messageId: parseInt(publicWithMsg[2], 10),
    };
  }

  // 6. Public channel Root (NO message ID) or direct username:
  // e.g., https://t.me/NareshItCoursesFree or @NareshItCoursesFree
  const publicRoot = clean.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me\/|@)?([a-zA-Z0-9_]{4,})$/);
  if (publicRoot && publicRoot[1].toLowerCase() !== "c") {
    return {
      channelId: publicRoot[1],
      messageId: null,
    };
  }

  return null;
}