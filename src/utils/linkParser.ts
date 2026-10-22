export interface ParsedLink {
  channelId: string | number;
  messageId: number;
}

export function parseTelegramLink(link: string): ParsedLink | null {
  const clean = link.trim();

  // Support Telegram Web URLs: https://web.telegram.org/a/#-1003641059847_18
  const webMatch = clean.match(/web\.telegram\.org\/[ak]\/#-?(\d+)[_/](\d+)/);
  if (webMatch) {
    const rawId = webMatch[1].startsWith("100") ? webMatch[1] : `100${webMatch[1]}`;
    return {
      channelId: `-100${rawId.replace(/^-100/, "")}`,
      messageId: parseInt(webMatch[2], 10),
    };
  }

  // Support t.me/c/ private links: https://t.me/c/3641059847/18 or /c/3641059847/18/19
  const privateMatch = clean.match(/t\.me\/c\/(\d+)(?:\/\d+)*\/(\d+)/);
  if (privateMatch) {
    return {
      channelId: `-100${privateMatch[1]}`,
      messageId: parseInt(privateMatch[2], 10),
    };
  }

  // Support public channel links: https://t.me/channel_name/123
  const publicMatch = clean.match(/t\.me\/([^/]+)(?:\/\d+)*\/(\d+)/);
  if (publicMatch) {
    return {
      channelId: publicMatch[1],
      messageId: parseInt(publicMatch[2], 10),
    };
  }

  return null;
}