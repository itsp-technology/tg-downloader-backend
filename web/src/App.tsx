import React, { useState, useEffect, useRef, useMemo } from "react";
import { AuthCard } from "./components/AuthCard.js";
import { MediaTable } from "./components/MediaTable.js";
import { ProgressBar } from "./components/ProgressBar.js";
import { ChannelMediaItem, QueueItem } from "./types.js";

const API_BASE = "http://localhost:5000";

export default function App(): React.JSX.Element {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [link, setLink] = useState("https://web.telegram.org/a/#-1003849411139");
  const [saveFolder, setSaveFolder] = useState("D:\\TelegramMedia");
  const [mediaItems, setMediaItems] = useState<ChannelMediaItem[]>([]);
  const [channelId, setChannelId] = useState<string | number>("");
  const [channelTitle, setChannelTitle] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const wakeLockRef = useRef<any>(null);

  // 1. Keep Laptop Awake (HTML5 Screen Wake Lock API)
  useEffect(() => {
    async function requestWakeLock() {
      if ("wakeLock" in navigator) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
          setWakeLockActive(true);

          wakeLockRef.current.addEventListener("release", () => {
            setWakeLockActive(false);
          });
        } catch {
          setWakeLockActive(false);
        }
      }
    }

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
      }
    };
  }, []);

  // Check login on load
  useEffect(() => {
    fetch(`${API_BASE}/api/auth/status`)
      .then((res) => res.json())
      .then((data) => setIsLoggedIn(data.authorized))
      .catch(() => setIsLoggedIn(false));
  }, []);

  // Poll download queue
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`${API_BASE}/api/download/queue-status`)
        .then((res) => res.json())
        .then((data) => setQueue(data))
        .catch(() => {});
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Total selected size formatted in GB
  const selectedSizeGB = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    const totalBytes = mediaItems
      .filter((item) => selectedSet.has(item.id))
      .reduce((sum, item) => sum + (item.fileSize || 0), 0);
    return (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
  }, [mediaItems, selectedIds]);

  const handleBrowseFolder = async () => {
    const res = await fetch(`${API_BASE}/api/system/browse-folder`);
    const data = await res.json();
    if (data.selectedFolder) setSaveFolder(data.selectedFolder);
  };

  const handleScanChannel = async () => {
    setScanning(true);
    setStatusMsg({ text: "Scanning all files in Telegram chronological order..." });
    setMediaItems([]);
    setSelectedIds([]);

    try {
      const res = await fetch(`${API_BASE}/api/media/scan-channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setMediaItems(data.items);
      setChannelId(data.channelId);
      setChannelTitle(data.channelTitle);

      // Default: Select all items
      setSelectedIds(data.items.map((i: ChannelMediaItem) => i.id));

      const totalGB = (
        data.items.reduce((sum: number, i: ChannelMediaItem) => sum + (i.fileSize || 0), 0) /
        (1024 * 1024 * 1024)
      ).toFixed(2);

      setStatusMsg({
        text: `Found ${data.items.length} media files in "${data.channelTitle}" (${totalGB} GB total)`,
      });
    } catch (e: any) {
      setStatusMsg({ text: e.message || "Failed to scan channel", error: true });
    } finally {
      setScanning(false);
    }
  };

  // Feature: Clear All Scanned Files
  const handleClearScannedList = () => {
    setMediaItems([]);
    setSelectedIds([]);
    setChannelId("");
    setChannelTitle("");
    setStatusMsg({ text: "Scanned files list cleared." });
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
      setStatusMsg({ text: `Enqueuing ${selectedIds.length} files (${selectedSizeGB} GB)...` });
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
      setStatusMsg({ text: `Successfully queued ${data.count} items (${selectedSizeGB} GB) for download!` });
    } catch (e: any) {
      setStatusMsg({ text: e.message, error: true });
    }
  };

  const handleStopDownload = async () => {
    await fetch(`${API_BASE}/api/download/stop`, { method: "POST" });
    setStatusMsg({ text: "Download stopping / pausing..." });
  };

  const handleResumeDownload = async (id: string) => {
    await fetch(`${API_BASE}/api/download/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setStatusMsg({ text: "Resuming download..." });
  };

  const handleClearCompleted = async () => {
    await fetch(`${API_BASE}/api/download/clear-completed`, { method: "POST" });
    setStatusMsg({ text: "Cleaned completed downloads from the queue." });
  };

  const handleRemoveItem = async (id: string) => {
    await fetch(`${API_BASE}/api/download/remove-item`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
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
    <div style={{ maxWidth: 720, margin: "30px auto", fontFamily: "system-ui, sans-serif", padding: "0 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h2 style={{ margin: 0, color: "#0f172a" }}>Telegram Media Suite</h2>
        <span
          style={{
            fontSize: "0.8rem",
            padding: "4px 8px",
            borderRadius: 4,
            backgroundColor: wakeLockActive ? "#dcfce7" : "#f1f5f9",
            color: wakeLockActive ? "#166534" : "#64748b",
            fontWeight: 600,
          }}
        >
          {wakeLockActive ? "☕ Keep-Awake: ON (Laptop won't sleep)" : "☕ Keep-Awake: Ready"}
        </span>
      </div>

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
              placeholder="https://web.telegram.org/a/#-1003849411139"
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
              {/* Header with Title and Clear Scanned List Button */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1e293b" }}>
                  Channel: {channelTitle} ({mediaItems.length} files)
                </span>
                <button
                  type="button"
                  onClick={handleClearScannedList}
                  style={{
                    padding: "4px 10px",
                    fontSize: "0.8rem",
                    backgroundColor: "#fee2e2",
                    color: "#b91c1c",
                    border: "1px solid #fecaca",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  🗑️ Clear Scanned List
                </button>
              </div>

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
                ⬇️ Download {selectedIds.length} Selected File(s) ({selectedSizeGB} GB)
              </button>
            </>
          )}

          <ProgressBar
            items={queue}
            onOpenExplorer={handleOpenExplorer}
            onStop={handleStopDownload}
            onResume={handleResumeDownload}
            onClearCompleted={handleClearCompleted}
            onRemoveItem={handleRemoveItem}
          />
        </div>
      )}
    </div>
  );
}