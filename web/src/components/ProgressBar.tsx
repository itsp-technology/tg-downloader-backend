import React from "react";
import { QueueItem } from "../types.js";

interface Props {
  items: QueueItem[];
  onOpenExplorer: (path: string) => void;
  onPause: () => void;
}

export const ProgressBar: React.FC<Props> = ({ items, onOpenExplorer, onPause }) => {
  if (items.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <h3>Download Queue ({items.filter((i) => i.status === "completed").length}/{items.length})</h3>
      {items.map((item) => (
        <div key={item.id} style={{ background: "#ffffff", border: "1px solid #e2e8f0", padding: 14, borderRadius: 6, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", fontWeight: 600 }}>
            <span style={{ maxWidth: 350, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.fileName}</span>
            <span style={{ color: item.status === "completed" ? "#16a34a" : item.status === "error" ? "#dc2626" : "#0284c7" }}>
              {item.status.toUpperCase()}
            </span>
          </div>

          <div style={{ width: "100%", height: 8, background: "#e2e8f0", borderRadius: 4, margin: "10px 0", overflow: "hidden" }}>
            <div style={{ width: `${item.percentage}%`, height: "100%", background: "#0284c7", transition: "width 0.2s" }} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "#64748b" }}>
            <span>{item.percentage}% ({item.speed})</span>
            <span>ETA: {item.eta}</span>
          </div>

          {item.status === "downloading" && (
            <button onClick={onPause} style={{ marginTop: 8, padding: "4px 10px", fontSize: "0.75rem", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}>
              Pause Download
            </button>
          )}

          {item.status === "completed" && (
            <button onClick={() => onOpenExplorer(item.targetFolder)} style={{ marginTop: 8, padding: "4px 10px", fontSize: "0.75rem", background: "#10b981", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}>
              📁 Open in Windows Explorer
            </button>
          )}
        </div>
      ))}
    </div>
  );
};