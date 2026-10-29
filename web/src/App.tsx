import React, { useState, useEffect, useRef, useMemo } from "react";
import { AuthCard } from "./components/AuthCard.js";
import { MediaTable } from "./components/MediaTable.js";
import { DownloadQueueList, QueueItemState } from "./components/DownloadQueueList.js";
import { ChannelMediaItem } from "./types.js";

const API_BASE = "http://localhost:5000"; // Relative path to backend

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
  const [queue, setQueue] = useState<QueueItemState[]>([]);

  // AbortControllers map for individual row cancellations
  const abortControllersRef = useRef<Map<number, AbortController>>(new Map());
  const wakeLockSentinelRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // ----------------------------------------------------
  // ROBUST SYSTEM KEEP-AWAKE (Dual Screen Lock + Audio Node)
  // ----------------------------------------------------
  const acquireWakeLock = async () => {
    // 1. Acquire Browser Screen WakeLock
    if ("wakeLock" in navigator) {
      try {
        if (!wakeLockSentinelRef.current || wakeLockSentinelRef.current.released) {
          const sentinel = await (navigator as any).wakeLock.request("screen");
          wakeLockSentinelRef.current = sentinel;
          setWakeLockActive(true);

          sentinel.addEventListener("release", () => {
            setWakeLockActive(false);
          });
        }
      } catch {
        // NotAllowedError if document is not visible or user has not interacted yet
      }
    }

    // 2. Start Silent Web Audio Loop (Prevents OS CPU sleep even when minimized/tab inactive)
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx && (!audioContextRef.current || audioContextRef.current.state === "suspended")) {
        if (!audioContextRef.current) {
          const ctx = new AudioCtx();
          const oscillator = ctx.createOscillator();
          const gainNode = ctx.createGain();

          oscillator.type = "sine";
          oscillator.frequency.value = 440;
          gainNode.gain.value = 0.0001; // Silent

          oscillator.connect(gainNode);
          gainNode.connect(ctx.destination);
          oscillator.start();

          audioContextRef.current = ctx;
        } else if (audioContextRef.current.state === "suspended") {
          await audioContextRef.current.resume();
        }
      }
    } catch {
      // AudioContext policy fallback
    }
  };

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        acquireWakeLock();
      }
    };

    const handleUserInteraction = () => {
      acquireWakeLock();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);
    window.addEventListener("click", handleUserInteraction, { once: true });
    window.addEventListener("keydown", handleUserInteraction, { once: true });

    acquireWakeLock();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
      window.removeEventListener("click", handleUserInteraction);
      window.removeEventListener("keydown", handleUserInteraction);
      if (wakeLockSentinelRef.current) {
        wakeLockSentinelRef.current.release().catch(() => {});
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
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
    await acquireWakeLock();
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
    await acquireWakeLock();
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

      setStatusMsg({ text: `Found ${data.items.length} media files in "${data.channelTitle}" (${totalGB} GB total). Ready to download.` });
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

  // --------------------------------------------------------------------------
  // STREAM DOWNLOAD ENGINE: Handles Stop, Resume, and Cancel via File System API
  // --------------------------------------------------------------------------
  const downloadFileStream = async (item: QueueItemState, startOffset: number = 0) => {
    let dirHandle = localDirectoryHandle;
    if (!dirHandle && "showDirectoryPicker" in window) {
      try {
        dirHandle = await (window as any).showDirectoryPicker();
        setLocalDirectoryHandle(dirHandle);
      } catch {
        return;
      }
    }

    const abortController = new AbortController();
    abortControllersRef.current.set(item.id, abortController);

    setQueue((prev) =>
      prev.map((q) => (q.id === item.id ? { ...q, status: "downloading" } : q))
    );

    try {
      const streamUrl = `${API_BASE}/api/download/stream?channelId=${encodeURIComponent(String(channelId))}&messageId=${item.id}&offset=${startOffset}`;

      if (dirHandle) {
        const fileHandle = await dirHandle.getFileHandle(item.fileName, { create: true });
        const writable = await fileHandle.createWritable({ keepExistingData: startOffset > 0 });

        if (startOffset > 0) {
          await writable.seek(startOffset);
        }

        const response = await fetch(streamUrl, { signal: abortController.signal });
        if (!response.body) throw new Error("Empty stream body");

        const reader = response.body.getReader();
        let downloaded = startOffset;
        let lastTime = Date.now();
        let lastBytes = startOffset;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          await writable.write(value);
          downloaded += value.length;

          const now = Date.now();
          if (now - lastTime >= 800) {
            const diffSec = (now - lastTime) / 1000;
            const bytesPerSec = (downloaded - lastBytes) / diffSec;
            const speed = `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;

            let eta = "--";
            if (bytesPerSec > 0 && item.totalBytes > downloaded) {
              const remSec = Math.round((item.totalBytes - downloaded) / bytesPerSec);
              eta = `${Math.floor(remSec / 60)}m ${remSec % 60}s`;
            }

            lastBytes = downloaded;
            lastTime = now;

            setQueue((prev) =>
              prev.map((q) =>
                q.id === item.id
                  ? {
                      ...q,
                      downloadedBytes: downloaded,
                      percentage: item.totalBytes > 0 ? Math.round((downloaded / item.totalBytes) * 100) : 50,
                      speed,
                      eta,
                    }
                  : q
              )
            );
          }
        }

        await writable.close();
      } else {
        // Fallback for browsers without direct File System API
        const a = document.createElement("a");
        a.href = streamUrl;
        a.setAttribute("download", item.fileName);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, percentage: 100, speed: "0 MB/s", eta: "Done", status: "completed" } : q))
      );
    } catch (err: any) {
      if (err.name === "AbortError") {
        // Paused or Cancelled
      } else {
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: "error", speed: "0 MB/s" } : q))
        );
      }
    } finally {
      abortControllersRef.current.delete(item.id);
    }
  };

  // Triggered manually upon clicking the download button
  const handleStartDownloads = async () => {
    if (selectedIds.length === 0) {
      setStatusMsg({ text: "Please select at least one file to download.", error: true });
      return;
    }

    await acquireWakeLock();
    const selectedItems = mediaItems.filter((i) => selectedIds.includes(i.id));

    const initialQueue: QueueItemState[] = selectedItems.map((item) => ({
      id: item.id,
      fileName: item.fileName,
      totalBytes: item.fileSize,
      downloadedBytes: 0,
      percentage: 0,
      speed: "0 MB/s",
      eta: "--",
      status: "pending",
    }));

    setQueue(initialQueue);

    for (const item of initialQueue) {
      await downloadFileStream(item, 0);
    }
  };

  // Row-level Action Handlers
  const handleStopItem = (id: number) => {
    const controller = abortControllersRef.current.get(id);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(id);
    }
    setQueue((prev) =>
      prev.map((q) => (q.id === id ? { ...q, status: "paused", speed: "0 MB/s", eta: "Paused" } : q))
    );
  };

  const handleResumeItem = (id: number) => {
    const item = queue.find((q) => q.id === id);
    if (item) {
      downloadFileStream(item, item.downloadedBytes);
    }
  };

  const handleCancelItem = (id: number) => {
    const controller = abortControllersRef.current.get(id);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(id);
    }
    setQueue((prev) => prev.filter((q) => q.id !== id));
  };

  const handleClearCompleted = () => {
    setQueue((prev) => prev.filter((q) => q.status !== "completed"));
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
            backgroundColor: wakeLockActive ? "#dcfce7" : "#fef3c7",
            color: wakeLockActive ? "#166534" : "#92400e",
            fontWeight: 600,
          }}
        >
          {wakeLockActive ? "☕ Laptop Awake: ACTIVE" : "☕ Click anywhere to activate Awake"}
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
                  onClick={handleStartDownloads}
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
              </div>
            </>
          )}

          {/* Individual Queue Item Controls: Stop, Resume, Cancel */}
          <DownloadQueueList
            queue={queue}
            onStopItem={handleStopItem}
            onResumeItem={handleResumeItem}
            onCancelItem={handleCancelItem}
            onClearCompleted={handleClearCompleted}
          />
        </div>
      )}
    </div>
  );
}