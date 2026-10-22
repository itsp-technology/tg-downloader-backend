import React from "react";
import { MediaPreview } from "../types.js";

interface Props {
  preview: MediaPreview;
}

export const PreviewCard: React.FC<Props> = ({ preview }) => {
  return (
    <div style={{ display: "flex", gap: 16, background: "#f8fafc", padding: 14, borderRadius: 6, border: "1px solid #e2e8f0", marginTop: 12 }}>
      {preview.thumbnailBase64 ? (
        <img src={preview.thumbnailBase64} alt="Thumbnail" style={{ width: 110, height: 75, objectFit: "cover", borderRadius: 4 }} />
      ) : (
        <div style={{ width: 110, height: 75, background: "#cbd5e1", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", color: "#475569" }}>
          No Preview
        </div>
      )}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <h4 style={{ margin: "0 0 6px 0", fontSize: "0.95rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {preview.fileName}
        </h4>
        <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
          <strong>Channel:</strong> {preview.channelTitle} | <strong>Size:</strong> {preview.formattedSize} | <strong>Duration:</strong> {preview.formattedDuration}
        </div>
        {preview.caption && (
          <p style={{ margin: "6px 0 0 0", fontSize: "0.8rem", color: "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {preview.caption}
          </p>
        )}
      </div>
    </div>
  );
};