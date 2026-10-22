import React, { useState, useMemo } from "react";
import { ChannelMediaItem } from "../types.js";

interface Props {
  items: ChannelMediaItem[];
  selectedIds: number[];
  onToggleSelect: (id: number) => void;
  onSelectAll: (ids: number[]) => void;
  onDeselectAll: () => void;
}

export const MediaTable: React.FC<Props> = ({
  items,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
}) => {
  const [filterType, setFilterType] = useState<string>("all");

  const filteredItems = useMemo(() => {
    if (filterType === "all") return items;
    return items.filter((item) => item.fileType === filterType);
  }, [items, filterType]);

  // Total byte calculations
  const totalAllBytes = useMemo(() => {
    return items.reduce((acc, item) => acc + (item.fileSize || 0), 0);
  }, [items]);

  const totalSelectedBytes = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    return items
      .filter((item) => selectedSet.has(item.id))
      .reduce((acc, item) => acc + (item.fileSize || 0), 0);
  }, [items, selectedIds]);

  // Convert raw bytes to GB formatted string
  const toGB = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024);
    return gb.toFixed(2);
  };

  const allFilteredSelected =
    filteredItems.length > 0 &&
    filteredItems.every((item) => selectedIds.includes(item.id));

  const handleSelectAllToggle = () => {
    if (allFilteredSelected) {
      onDeselectAll();
    } else {
      onSelectAll(filteredItems.map((item) => item.id));
    }
  };

  const getTypeBadgeColor = (type: ChannelMediaItem["fileType"]) => {
    switch (type) {
      case "video":
        return "#0284c7";
      case "pdf":
        return "#dc2626";
      case "zip":
        return "#d97706";
      case "audio":
        return "#9333ea";
      default:
        return "#475569";
    }
  };

  if (items.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: "center", color: "#64748b", background: "#f8fafc", borderRadius: 6 }}>
        No media files found in this topic or channel.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      {/* Total Data Summary Card */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          padding: 12,
          backgroundColor: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          marginBottom: 12,
        }}
      >
        <div style={{ textAlign: "center", borderRight: "1px solid #cbd5e1" }}>
          <div style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>
            Total Channel Media Size
          </div>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
            {toGB(totalAllBytes)} <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>GB</span>
          </div>
          <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
            Across all {items.length} files
          </div>
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "0.75rem", color: "#0369a1", textTransform: "uppercase", fontWeight: 700 }}>
            Selected to Download Size
          </div>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#0284c7", marginTop: 2 }}>
            {toGB(totalSelectedBytes)} <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>GB</span>
          </div>
          <div style={{ fontSize: "0.75rem", color: "#0284c7" }}>
            {selectedIds.length} of {items.length} files ticked
          </div>
        </div>
      </div>

      {/* Filter and Selection Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["all", "video", "pdf", "zip", "audio"].map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              style={{
                padding: "4px 10px",
                fontSize: "0.75rem",
                borderRadius: 4,
                border: "1px solid #cbd5e1",
                background: filterType === t ? "#0f172a" : "#ffffff",
                color: filterType === t ? "#ffffff" : "#334155",
                cursor: "pointer",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <div style={{ fontSize: "0.85rem", color: "#475569" }}>
          Selected: <strong>{selectedIds.length}</strong> / {items.length} items (<strong>{toGB(totalSelectedBytes)} GB</strong>)
        </div>
      </div>

      {/* Selectable Items Container */}
      <div style={{ maxHeight: 340, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
          <thead style={{ background: "#f1f5f9", position: "sticky", top: 0, zIndex: 1 }}>
            <tr>
              <th style={{ padding: "8px 10px", width: 36, textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={handleSelectAllToggle}
                  style={{ cursor: "pointer" }}
                />
              </th>
              <th style={{ padding: "8px 10px" }}>File Name</th>
              <th style={{ padding: "8px 10px", width: 70 }}>Type</th>
              <th style={{ padding: "8px 10px", width: 80, textAlign: "right" }}>Size</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => {
              const isChecked = selectedIds.includes(item.id);
              return (
                <tr
                  key={item.id}
                  onClick={() => onToggleSelect(item.id)}
                  style={{
                    borderBottom: "1px solid #f1f5f9",
                    cursor: "pointer",
                    backgroundColor: isChecked ? "#f0fdf4" : "transparent",
                  }}
                >
                  <td style={{ padding: "8px 10px", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggleSelect(item.id)}
                      style={{ cursor: "pointer" }}
                    />
                  </td>
                  <td style={{ padding: "8px 10px", wordBreak: "break-all" }}>
                    <div style={{ fontWeight: isChecked ? 600 : 400, color: "#1e293b" }}>{item.fileName}</div>
                    {item.caption && (
                      <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 360 }}>
                        {item.caption}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        padding: "2px 6px",
                        borderRadius: 3,
                        color: "#fff",
                        backgroundColor: getTypeBadgeColor(item.fileType),
                        textTransform: "uppercase",
                        fontWeight: 600,
                      }}
                    >
                      {item.fileType}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: "#475569", whiteSpace: "nowrap" }}>
                    {item.formattedSize}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};