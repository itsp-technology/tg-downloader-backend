import React, { useState, useEffect, useRef, useMemo } from "react";
import { AuthCard } from "./components/AuthCard.js";
import { MediaTable } from "./components/MediaTable.js";
import { ChannelMediaItem } from "./types.js";

const API_BASE = ""; // Relative path to Render backend

interface LocalDownloadProgress {
  id: number;
  fileName: string;
  totalBytes: number;
  downloadedBytes: number;
  percentage: number;
  speed: string;
  status: "pending" | "downloading" | "completed" | "error" | "stopped";
}

export default function App(): React.JSX.Element {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [link, setLink] = useState("https://web.telegram.org/a/#-1003849411139");
  const [mediaItems, setMediaItems] = useState<ChannelMediaItem[]>([]);
  const [channelId, setChannelId] = useState<string | number>("");
  const [channelTitle, setChannelTitle] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [scanning, setScanning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [localDirectoryHandle, setLocalDirectoryHandle] = useState<any>(null);
  const [localQueue, setLocalQueue] = useState<LocalDownloadProgress[]>([]);
  const isCancelledRef = useRef(false);

  // 1. Keep Laptop Awake (No Sleep)
  useEffect(() => {
    let wakeLock: any = null;
    async function requestWakeLock() {
      if ("wakeLock" in navigator) {
        try {
          wakeLock = await (navigator as any).wakeLock.request("screen");
          setWakeLockActive(true);
        } catch {
          setWakeLockActive(false);
        }
      }
    }
    requestWakeLock();
    return () => {
      if (wakeLock) wakeLock.release();
    };
  }, []);

  // Check login status on load
  useEffect(() => {
    fetch(`${API_BASE}/api/auth/status`)
      .then((res) => res.json())
      .then((data) => setIsLoggedIn(data.authorized))
      .catch(() => setIsLoggedIn(false));
  }, []);

  // Total selected size in GB
  const selectedSizeGB = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    const totalBytes = mediaItems
      .filter((item) => selectedSet.has(item.id))
      .reduce((sum, item) => sum + (item.fileSize || 0), 0);
    return (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
  }, [mediaItems, selectedIds]);

  // Pick Local Destination Folder on User's PC
  const handlePickLocalFolder = async () => {
    if ("showDirectoryPicker" in window) {
      try {
        const handle = await (window as any).showDirectoryPicker();
        setLocalDirectoryHandle(handle);
        setStatusMsg({ text: `Local folder selected: "${handle.name}". Files will save directly here.` });
      } catch {
        // User canceled picker
      }
    } else {
      setStatusMsg({ text: "Browser folder picker not supported. Files will download to default Downloads folder." });
    }
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
      setSelectedIds(data.items.map((i: ChannelMediaItem) => i.id));

      const totalGB = (
        data.items.reduce((sum: number, i: ChannelMediaItem) => sum + (i.fileSize || 0), 0) /
        (1024 * 1024 * 1024)
      ).toFixed(2);

      setStatusMsg({ text: `Found ${data.items.length} media files in "${data.channelTitle}" (${totalGB} GB total)` });
    } catch (e: any) {
      setStatusMsg({ text: e.message || "Failed to scan channel", error: true });
    } finally {
      setScanning(false);
    }
  };

  const handleClearScannedList = () => {
    setMediaItems([]);
    setSelectedIds([]);
    setStatusMsg({ text: "Scanned files list cleared." });
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  // Direct Local Disk Stream (0 Cloud Space Used)
  const handleStartLocalDownload = async () => {
    if (selectedIds.length === 0) {
      setStatusMsg({ text: "Please select at least one file to download.", error: true });
      return;
    }

    isCancelledRef.current = false;
    const selectedItems = mediaItems.filter((i) => selectedIds.includes(i.id));

    // Initialize local queue
    const queueInit: LocalDownloadProgress[] = selectedItems.map((item) => ({
      id: item.id,
      fileName: item.fileName,
      totalBytes: item.fileSize,
      downloadedBytes: 0,
      percentage: 0,
      speed: "0 MB/s",
      status: "pending",
    }));
    setLocalQueue(queueInit);

    let dirHandle = localDirectoryHandle;
    // Ask for folder if not selected yet
    if (!dirHandle && "showDirectoryPicker" in window) {
      try {
        dirHandle = await (window as any).showDirectoryPicker();
        setLocalDirectoryHandle(dirHandle);
      } catch {
        // Fallback to standard browser download
      }
    }

    for (let i = 0; i < selectedItems.length; i++) {
      if (isCancelledRef.current) break;
      const item = selectedItems[i];

      setLocalQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: "downloading" } : q))
      );

      try {
        const streamUrl = `${API_BASE}/api/download/stream?channelId=${encodeURIComponent(String(channelId))}&messageId=${item.id}`;

        if (dirHandle) {
          // Direct local file writer via Web File System API
          const fileHandle = await dirHandle.getFileHandle(item.fileName, { create: true });
          const writable = await fileHandle.createWritable();

          const response = await fetch(streamUrl);
          if (!response.body) throw new Error("Empty stream body");

          const reader = response.body.getReader();
          let downloaded = 0;
          let lastTime = Date.now();
          let lastBytes = 0;

          while (true) {
            if (isCancelledRef.current) {
              await writable.close();
              break;
            }

            const { done, value } = await reader.read();
            if (done) break;

            await writable.write(value);
            downloaded += value.length;

            const now = Date.now();
            if (now - lastTime >= 1000) {
              const diffSec = (now - lastTime) / 1000;
              const speed = `${((downloaded - lastBytes) / (1024 * 1024 * diffSec)).toFixed(2)} MB/s`;
              lastBytes = downloaded;
              lastTime = now;

              setLocalQueue((prev) =>
                prev.map((q) =>
                  q.id === item.id
                    ? {
                        ...q,
                        downloadedBytes: downloaded,
                        percentage: item.fileSize > 0 ? Math.round((downloaded / item.fileSize) * 100) : 50,
                        speed,
                      }
                    : q
                )
              );
            }
          }

          await writable.close();
        } else {
          // Standard browser attachment download fallback
          const a = document.createElement("a");
          a.href = streamUrl;
          a.setAttribute("download", item.fileName);
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }

        setLocalQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, percentage: 100, speed: "0 MB/s", status: "completed" } : q))
        );
      } catch (err: any) {
        setLocalQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: "error" } : q))
        );
      }
    }
  };

  const handleStopDownloads = () => {
    isCancelledRef.current = true;
    setLocalQueue((prev) =>
      prev.map((q) => (q.status === "downloading" ? { ...q, status: "stopped" } : q))
    );
    setStatusMsg({ text: "Downloads stopped." });
  };

  const handleClearCompleted = () => {
    setLocalQueue((prev) => prev.filter((q) => q.status !== "completed"));
  };

  return (
    <div style={{ maxWidth: 740, margin: "30px auto", fontFamily: "system-ui, sans-serif", padding: "0 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h2 style={{ margin: 0, color: "#0f172a" }}>Telegram Local Downloader (0 Cloud Storage)</h2>
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
          {wakeLockActive ? "☕ Laptop Awake: ON" : "☕ Keep-Awake: Ready"}
        </span>
      </div>

      <AuthCard
        apiBase={API_BASE}
        isLoggedIn={isLoggedIn}
        onAuthorized={() => setIsLoggedIn(true)}
        onLogout={() => fetch(`${API_BASE}/api/auth/logout`, { method: "POST" }).then(() => setIsLoggedIn(false))}
      />

      {isLoggedIn && (
        <div style={{ background: "#fff", padding: 20, borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Telegram Channel or Topic Link</label>
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

          <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Local Hard Drive Destination Folder</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input
              style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #cbd5e1", background: "#f8fafc" }}
              readOnly
              value={localDirectoryHandle ? `Local Folder: ${localDirectoryHandle.name}` : "Click Browse to select local drive folder (e.g. D:\\Y)"}
            />
            <button
              onClick={handlePickLocalFolder}
              style={{ padding: "8px 14px", background: "#e2e8f0", border: "1px solid #cbd5e1", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
            >
              📁 Browse Local PC...
            </button>
          </div>

          {statusMsg && (
            <div style={{ padding: "8px 12px", borderRadius: 4, marginBottom: 12, fontSize: "0.85rem", background: statusMsg.error ? "#fee2e2" : "#f0fdf4", color: statusMsg.error ? "#b91c1c" : "#166534" }}>
              {statusMsg.text}
            </div>
          )}

          {mediaItems.length > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1e293b" }}>
                  Channel: {channelTitle} ({mediaItems.length} files)
                </span>
                <button
                  type="button"
                  onClick={handleClearScannedList}
                  style={{ padding: "4px 10px", fontSize: "0.8rem", backgroundColor: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                >
                  🗑️ Clear Scanned List
                </button>
              </div>

              <MediaTable
                items={mediaItems}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onSelectAll={(ids) => setSelectedIds(ids)}
                onDeselectAll={() => setSelectedIds([])}
              />

              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <button
                  onClick={handleStartLocalDownload}
                  disabled={selectedIds.length === 0}
                  style={{
                    flex: 1,
                    padding: 12,
                    background: selectedIds.length > 0 ? "#0284c7" : "#94a3b8",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    cursor: selectedIds.length > 0 ? "pointer" : "not-allowed",
                    fontWeight: 600,
                  }}
                >
                  ⬇️ Download {selectedIds.length} Selected Files Directly to PC ({selectedSizeGB} GB)
                </button>

                {localQueue.some((q) => q.status === "downloading") && (
                  <button
                    onClick={handleStopDownloads}
                    style={{ padding: "12px 20px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                  >
                    ⏹ Stop
                  </button>
                )}
              </div>
            </>
          )}

          {/* Local Download Queue Progress Display */}
          {localQueue.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ fontSize: "1.05rem", color: "#0f172a", margin: 0 }}>
                  Local PC Download Queue ({localQueue.filter((i) => i.status === "completed").length}/{localQueue.length} Completed)
                </h3>
                {localQueue.some((i) => i.status === "completed") && (
                  <button
                    onClick={handleClearCompleted}
                    style={{ padding: "4px 10px", fontSize: "0.8rem", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 4, cursor: "pointer" }}
                  >
                    🧹 Clean Completed
                  </button>
                )}
              </div>

              {localQueue.map((item) => (
                <div key={item.id} style={{ background: "#ffffff", border: "1px solid #e2e8f0", padding: 12, borderRadius: 6, marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", fontWeight: 600 }}>
                    <span style={{ maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.fileName}</span>
                    <span style={{ color: item.status === "completed" ? "#16a34a" : item.status === "error" ? "#dc2626" : "#0284c7" }}>
                      {item.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ width: "100%", height: 6, background: "#e2e8f0", borderRadius: 3, margin: "8px 0", overflow: "hidden" }}>
                    <div style={{ width: `${item.percentage}%`, height: "100%", background: item.status === "completed" ? "#16a34a" : "#0284c7" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#64748b" }}>
                    <span>{item.percentage}% ({item.speed})</span>
                    <span>{(item.totalBytes / (1024 * 1024)).toFixed(1)} MB</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}