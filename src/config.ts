import path from "node:path";

export const CONFIG = {
  PORT: 5000,
  SESSION_FILE: path.resolve(process.cwd(), "session.txt"),
  CHUNK_SIZE: 512 * 1024, // 512 KB per chunk
  SPEED_SAMPLE_INTERVAL_SEC: 1,
};