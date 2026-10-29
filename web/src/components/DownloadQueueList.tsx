import React from "react";

export interface QueueItemState {
  id: number;
  fileName: string;
  totalBytes: number;
  downloadedBytes: number;
  percentage: number;
  speed: string;
  eta: string;
  status: "pending" | "downloading" | "paused" | "completed" | "error" | "cancelled";
}

interface Props {
  queue: QueueItemState[];
  onStopItem: (id: number) => void;
  onResumeItem: (id: number) => void;
  onCancelItem: (id: number) => void;
  onClearCompleted: () => void;
}

export const DownloadQueueList: React.FC<Props> = ({
  queue,
  onStopItem,
  onResumeItem,
  onCancelItem,
  onClearCompleted,
}) => {
  if (queue.length === 0) return null;

  const completedCount = queue.filter((i) => i.status === "completed").length;

  const getStatusColor = (status: QueueItemState["status"]) => {
    switch (status) {
      case "completed":
        return "#16a34a";
      case "downloading":
        return "#0284c7";
      case "paused":
        return "#d97706";
      case "error":
        return "#dc2626";
      case "cancelled":
        return "#64748b";
      default:
        return "#94a3b8";
    }
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ fontSize: "1.05rem", color: "#0f172a", margin: 0 }}>
          Download Queue ({completedCount}/{queue.length} Finished)
        </h3>
        {completedCount > 0 && (
          <button
            type="button"
            onClick={onClearCompleted}
            style={{
              padding: "4px 10px",
              fontSize: "0.8rem",
              background: "#f1f5f9",
              border: "1px solid #cbd5e1",
              borderRadius: 4,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            🧹 Clean Completed ({completedCount})
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {queue.map((item) => (
          <div
            key={item.id}
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              padding: 12,
              borderRadius: 6,
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}
          >
            {/* Header: Title + Status Badge */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.85rem", fontWeight: 600 }}>
              <span style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1e293b" }}>
                {item.fileName}
              </span>
              <span
                style={{
                  color: getStatusColor(item.status),
                  fontSize: "0.75rem",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                {item.status}
              </span>
            </div>

            {/* Progress Bar */}
            <div style={{ width: "100%", height: 6, background: "#e2e8f0", borderRadius: 3, margin: "8px 0", overflow: "hidden" }}>
              <div
                style={{
                  width: `${item.percentage}%`,
                  height: "100%",
                  background: getStatusColor(item.status),
                  transition: "width 0.2s ease-in-out",
                }}
              />
            </div>

            {/* Detail Metrics */}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#64748b" }}>
              <span>
                {item.percentage}% ({item.speed}) — {(item.downloadedBytes / (1024 * 1024)).toFixed(1)} / {(item.totalBytes / (1024 * 1024)).toFixed(1)} MB
              </span>
              <span>ETA: {item.eta}</span>
            </div>

            {/* Row Action Controls: Stop, Resume, Cancel */}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {item.status === "downloading" && (
                <button
                  type="button"
                  onClick={() => onStopItem(item.id)}
                  style={{
                    padding: "4px 10px",
                    fontSize: "0.75rem",
                    background: "#fef3c7",
                    color: "#92400e",
                    border: "1px solid #fde68a",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  ⏸ Stop
                </button>
              )}

              {(item.status === "paused" || item.status === "error") && (
                <button
                  type="button"
                  onClick={() => onResumeItem(item.id)}
                  style={{
                    padding: "4px 10px",
                    fontSize: "0.75rem",
                    background: "#dcfce7",
                    color: "#166534",
                    border: "1px solid #bbf7d0",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  ▶ Resume
                </button>
              )}

              {item.status !== "completed" && item.status !== "cancelled" && (
                <button
                  type="button"
                  onClick={() => onCancelItem(item.id)}
                  style={{
                    padding: "4px 10px",
                    fontSize: "0.75rem",
                    background: "#fee2e2",
                    color: "#991b1b",
                    border: "1px solid #fecaca",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  ✕ Cancel
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};