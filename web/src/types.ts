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

export interface QueueItem {
  id: string;
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