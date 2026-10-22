import React, { useState, useEffect } from "react";
import { AuthCard } from "./components/AuthCard.js";
import { PreviewCard } from "./components/PreviewCard.js";
import { ProgressBar } from "./components/ProgressBar.js";
import { MediaPreview, QueueItem } from "./types.js";

const API_BASE = "http://localhost:5000";

export default function App(): React.JSX.Element {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [link, setLink] = useState("https://t.me/c/2869794586/595");
  const [endMessageId, setEndMessageId] = useState("");
  const [saveFolder, setSaveFolder] = useState("D:\\TelegramMedia");
  const [preview, setPreview] = useState<MediaPreview | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Check persistent disk session on start
  useEffect(() => {
    fetch(`${API_BASE}/api/auth/status`)
      .then((res) => res.json())
      .then((data) => setIsLoggedIn(data.authorized))
      .catch(() => setIsLoggedIn(false));
  }, []);

  // Poll active download queue
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`${API_BASE}/api/download/queue-status`)
        .then((res) => res.json())
        .then((data) => setQueue(data))
        .catch(() => {});
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleBrowseFolder = async () => {
    const res = await fetch(`${API_BASE}/api/system/browse-folder`);
    const data = await res.json();
    if (data.selectedFolder) setSaveFolder(data.selectedFolder);
  };

  const handleFetchPreview = async () => {
    setLoadingPreview(true);
    setPreview(null);
    try {
      const res = await fetch(`${API_BASE}/api/media/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link }),
      });
      const data = await res.json();
      if (res.ok) setPreview(data);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleEnqueue = async () => {
    await fetch(`${API_BASE}/api/download/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link, saveFolder, endMessageId }),
    });
  };

  const handleOpenExplorer = (folder: string) => {
    fetch(`${API_BASE}/api/system/open-explorer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath: folder }),
    });
  };

  const handleLogout = async () => {
    await fetch(`${API_BASE}/api/auth/logout`, { method: "POST" });
    setIsLoggedIn(false);
  };

  return (
    <div style={{ maxWidth: 640, margin: "30px auto", fontFamily: "system-ui, sans-serif", padding: "0 16px" }}>
      <h2>Telegram Media Suite</h2>

      <AuthCard
        apiBase={API_BASE}
        isLoggedIn={isLoggedIn}
        onAuthorized={() => setIsLoggedIn(true)}
        onLogout={handleLogout}
      />

      {isLoggedIn && (
        <div style={{ background: "#fff", padding: 20, borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Telegram Link</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #cbd5e1" }}
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
            <button
              onClick={handleFetchPreview}
              disabled={loadingPreview}
              style={{ padding: "8px 14px", background: "#e2e8f0", border: "1px solid #cbd5e1", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
            >
              {loadingPreview ? "Checking..." : "Inspect"}
            </button>
          </div>

          <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Batch End Message ID (Optional for Range Downloads)</label>
          <input
            style={{ width: "100%", padding: 8, boxSizing: "border-box", borderRadius: 4, border: "1px solid #cbd5e1", marginBottom: 12 }}
            placeholder="e.g. 620 to batch download 595 to 620"
            value={endMessageId}
            onChange={(e) => setEndMessageId(e.target.value)}
          />

          <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Save Directory</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input
              style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #cbd5e1" }}
              value={saveFolder}
              onChange={(e) => setSaveFolder(e.target.value)}
            />
            <button
              onClick={handleBrowseFolder}
              style={{ padding: "8px 14px", background: "#e2e8f0", border: "1px solid #cbd5e1", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
            >
              📁 Browse...
            </button>
          </div>

          {preview && <PreviewCard preview={preview} />}

          <button
            onClick={handleEnqueue}
            style={{ width: "100%", padding: 12, background: "#0284c7", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600, marginTop: 14 }}
          >
            Start Download / Add to Queue
          </button>

          <ProgressBar
            items={queue}
            onOpenExplorer={handleOpenExplorer}
            onPause={() => fetch(`${API_BASE}/api/download/pause`, { method: "POST" })}
          />
        </div>
      )}
    </div>
  );
}