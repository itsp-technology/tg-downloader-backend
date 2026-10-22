import React from "react";
import { QueueItem } from "../types.js";

interface Props {
  items: QueueItem[];
  onOpenExplorer: (path: string) => void;
  onStop: () => void;
  onResume: (id: string) => void;
}

export const ProgressBar: React.FC<Props> = ({ items, onOpenExplorer, onStop, onResume }) => {
  if (items.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: "1.05rem", color: "#0f172a", marginBottom: 12 }}>
        Download Queue ({items.filter((i) => i.status === "completed").length}/{items.length} Completed)
      </h3>
      {items.map((item) => (
        <div
          key={item.id}
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            padding: 14,
            borderRadius: 6,
            marginBottom: 12,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", fontWeight: 600 }}>
            <span style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.fileName}
            </span>
            <span
              style={{
                color:
                  item.status === "completed"
                    ? "#16a34a"
                    : item.status === "error"
                    ? "#dc2626"
                    : item.status === "paused"
                    ? "#d97706"
                    : "#0284c7",
                fontSize: "0.8rem",
                textTransform: "uppercase",
              }}
            >
              {item.status}
            </span>
          </div>

          <div style={{ width: "100%", height: 8, background: "#e2e8f0", borderRadius: 4, margin: "10px 0", overflow: "hidden" }}>
            <div
              style={{
                width: `${item.percentage}%`,
                height: "100%",
                background: item.status === "paused" ? "#d97706" : "#0284c7",
                transition: "width 0.2s",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "#64748b" }}>
            <span>
              {item.percentage}% ({item.speed})
            </span>
            <span>ETA: {item.eta}</span>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {item.status === "downloading" && (
              <button
                onClick={onStop}
                style={{
                  padding: "5px 12px",
                  fontSize: "0.8rem",
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                ⏹ Stop Download
              </button>
            )}

            {(item.status === "paused" || item.status === "error") && (
              <button
                onClick={() => onResume(item.id)}
                style={{
                  padding: "5px 12px",
                  fontSize: "0.8rem",
                  background: "#16a34a",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                ▶ Resume Download
              </button>
            )}

            {item.status === "completed" && (
              <button
                onClick={() => onOpenExplorer(item.targetFolder)}
                style={{
                  padding: "5px 12px",
                  fontSize: "0.8rem",
                  background: "#0f172a",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                📁 Open in Explorer
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};