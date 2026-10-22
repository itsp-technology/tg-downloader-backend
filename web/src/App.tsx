import React, { useState, useEffect } from "react";
import { AuthCard } from "./components/AuthCard.js";
import { MediaTable } from "./components/MediaTable.js";
import { ProgressBar } from "./components/ProgressBar.js";
import { ChannelMediaItem, QueueItem } from "./types.js";

const API_BASE = "http://localhost:5000";

export default function App(): React.JSX.Element {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [link, setLink] = useState("https://t.me/c/3641059847/18");
  const [saveFolder, setSaveFolder] = useState("D:\\TelegramMedia");
  const [mediaItems, setMediaItems] = useState<ChannelMediaItem[]>([]);
  const [channelId, setChannelId] = useState<string | number>("");
  const [channelTitle, setChannelTitle] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; error?: boolean } | null>(null);

  // Check login on load
  useEffect(() => {
    fetch(`${API_BASE}/api/auth/status`)
      .then((res) => res.json())
      .then((data) => setIsLoggedIn(data.authorized))
      .catch(() => setIsLoggedIn(false));
  }, []);

  // Poll download progress queue
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

  const handleScanChannel = async () => {
    setScanning(true);
    setStatusMsg({ text: "Scanning channel/topic for media..." });
    setMediaItems([]);
    setSelectedIds([]);

    try {
      const res = await fetch(`${API_BASE}/api/media/scan-channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link, limit: 60 }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setMediaItems(data.items);
      setChannelId(data.channelId);
      setChannelTitle(data.channelTitle);

      // Default: Tick all items
      setSelectedIds(data.items.map((i: ChannelMediaItem) => i.id));
      setStatusMsg({ text: `Found ${data.items.length} media files in "${data.channelTitle}"` });
    } catch (e: any) {
      setStatusMsg({ text: e.message || "Failed to scan channel", error: true });
    } finally {
      setScanning(false);
    }
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = (ids: number[]) => setSelectedIds(ids);
  const handleDeselectAll = () => setSelectedIds([]);

  const handleDownloadSelected = async () => {
    if (selectedIds.length === 0) {
      setStatusMsg({ text: "Please select at least one file to download.", error: true });
      return;
    }

    try {
      setStatusMsg({ text: `Enqueuing ${selectedIds.length} files...` });
      const res = await fetch(`${API_BASE}/api/download/enqueue-selected`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          saveFolder,
          selectedIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStatusMsg({ text: `Successfully queued ${data.count} items for download!` });
    } catch (e: any) {
      setStatusMsg({ text: e.message, error: true });
    }
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
    <div style={{ maxWidth: 700, margin: "30px auto", fontFamily: "system-ui, sans-serif", padding: "0 16px" }}>
      <h2>Telegram Media Downloader Suite</h2>

      <AuthCard
        apiBase={API_BASE}
        isLoggedIn={isLoggedIn}
        onAuthorized={() => setIsLoggedIn(true)}
        onLogout={handleLogout}
      />

      {isLoggedIn && (
        <div style={{ background: "#fff", padding: 20, borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Telegram Link (Channel, Supergroup, or Topic)</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #cbd5e1" }}
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://t.me/c/3641059847/18"
            />
            <button
              onClick={handleScanChannel}
              disabled={scanning}
              style={{ padding: "8px 16px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
            >
              {scanning ? "Scanning..." : "🔍 Scan Files"}
            </button>
          </div>

          <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Destination Directory</label>
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

          {statusMsg && (
            <div style={{ padding: "8px 12px", borderRadius: 4, marginBottom: 12, fontSize: "0.85rem", background: statusMsg.error ? "#fee2e2" : "#f0fdf4", color: statusMsg.error ? "#b91c1c" : "#166534" }}>
              {statusMsg.text}
            </div>
          )}

          {mediaItems.length > 0 && (
            <>
              <MediaTable
                items={mediaItems}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onSelectAll={handleSelectAll}
                onDeselectAll={handleDeselectAll}
              />

              <button
                onClick={handleDownloadSelected}
                disabled={selectedIds.length === 0}
                style={{
                  width: "100%",
                  padding: 12,
                  background: selectedIds.length > 0 ? "#0284c7" : "#94a3b8",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  cursor: selectedIds.length > 0 ? "pointer" : "not-allowed",
                  fontWeight: 600,
                  marginTop: 14,
                }}
              >
                ⬇️ Download {selectedIds.length} Selected File(s)
              </button>
            </>
          )}

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