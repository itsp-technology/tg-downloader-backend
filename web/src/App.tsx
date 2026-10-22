import React, { useState, useEffect, CSSProperties } from "react";

const API_BASE = "http://localhost:5000";

interface StatusMessage {
  text: string;
  type: "info" | "success" | "error";
}

interface ProgressData {
  active: boolean;
  percentage: number;
  downloadedBytes: number;
  totalBytes: number;
  status: string;
}

export default function App(): React.JSX.Element {
  const [step, setStep] = useState<"credentials" | "code" | "2fa" | "download">("credentials");
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [link, setLink] = useState("https://t.me/c/2869794586/595");
  const [saveFolder, setSaveFolder] = useState("D:\\TelegramMedia");
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressData>({
    active: false,
    percentage: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    status: "idle",
  });

  // Poll progress when downloading
  useEffect(() => {
    let interval: any = null;
    if (loading && step === "download") {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/api/download-progress`);
          const data = await res.json();
          setProgress(data);
        } catch {
          // ignore polling errors
        }
      }, 500);
    } else {
      if (interval) clearInterval(interval);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [loading, step]);

  const handleBrowseFolder = async () => {
    try {
      setStatus({ text: "Opening Windows Folder Browser...", type: "info" });
      const res = await fetch(`${API_BASE}/api/browse-folder`);
      const data = await res.json();
      if (data.selectedFolder) {
        setSaveFolder(data.selectedFolder);
        setStatus({ text: `Folder selected: ${data.selectedFolder}`, type: "success" });
      } else {
        setStatus({ text: "Folder selection canceled.", type: "info" });
      }
    } catch {
      setStatus({ text: "Could not open folder picker. You can type the path manually.", type: "error" });
    }
  };

  const handleSendCode = async () => {
    setLoading(true);
    setStatus({ text: "Requesting Telegram verification code...", type: "info" });
    try {
      const res = await fetch(`${API_BASE}/api/auth/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiId: Number(apiId), apiHash, phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send code");

      if (data.status === "AUTHORIZED") {
        setStep("download");
        setStatus({ text: "Already authorized! Ready to download.", type: "success" });
      } else {
        setStep("code");
        setStatus({ text: data.message, type: "info" });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setStatus({ text: message, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    setLoading(true);
    setStatus({ text: "Verifying code...", type: "info" });
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to verify code");

      if (data.status === "2FA_REQUIRED") {
        setStep("2fa");
        setStatus({ text: "Two-step verification active. Enter your password.", type: "info" });
      } else {
        setStep("download");
        setStatus({ text: "Successfully authenticated!", type: "success" });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setStatus({ text: message, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2FA = async () => {
    setLoading(true);
    setStatus({ text: "Verifying 2FA password...", type: "info" });
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed 2FA verification");

      setStep("download");
      setStatus({ text: "Authenticated successfully!", type: "success" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setStatus({ text: message, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    setLoading(true);
    setStatus({ text: "Connecting to channel & preparing file stream...", type: "info" });
    try {
      const res = await fetch(`${API_BASE}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link, saveFolder }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Download failed");

      setStatus({ text: `Done! File saved to: ${data.filePath}`, type: "success" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setStatus({ text: message, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const formatMB = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2);

  return (
    <div style={{ maxWidth: 560, margin: "40px auto", fontFamily: "system-ui, sans-serif", padding: 24, background: "#ffffff", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
      <h2 style={{ marginTop: 0, color: "#0f172a" }}>Telegram Media Downloader</h2>

      {step === "credentials" && (
        <div>
          <label style={labelStyle}>API ID</label>
          <input style={inputStyle} value={apiId} onChange={(e) => setApiId(e.target.value)} placeholder="12345678" />
          <label style={labelStyle}>API Hash</label>
          <input style={inputStyle} value={apiHash} onChange={(e) => setApiHash(e.target.value)} placeholder="0123456789abcdef..." />
          <label style={labelStyle}>Phone Number</label>
          <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" />
          <button style={btnStyle} disabled={loading} onClick={handleSendCode}>
            {loading ? "Sending..." : "Send Verification Code"}
          </button>
        </div>
      )}

      {step === "code" && (
        <div>
          <label style={labelStyle}>Enter Login Code</label>
          <input style={inputStyle} value={code} onChange={(e) => setCode(e.target.value)} placeholder="12345" />
          <button style={btnStyle} disabled={loading} onClick={handleVerifyCode}>
            {loading ? "Verifying..." : "Verify Code"}
          </button>
        </div>
      )}

      {step === "2fa" && (
        <div>
          <label style={labelStyle}>Enter 2FA Password</label>
          <input type="password" style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button style={btnStyle} disabled={loading} onClick={handleVerify2FA}>
            {loading ? "Submitting..." : "Submit 2FA"}
          </button>
        </div>
      )}

      {step === "download" && (
        <div>
          <label style={labelStyle}>Telegram Post Link</label>
          <input style={inputStyle} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://t.me/c/2869794586/595" />

          <label style={labelStyle}>Save Folder</label>
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            <input
              style={{ ...inputStyle, marginBottom: 0 }}
              value={saveFolder}
              onChange={(e) => setSaveFolder(e.target.value)}
              placeholder="Select or enter folder path"
            />
            <button
              type="button"
              onClick={handleBrowseFolder}
              style={{
                padding: "8px 16px",
                backgroundColor: "#e2e8f0",
                color: "#1e293b",
                border: "1px solid #cbd5e1",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              📁 Browse...
            </button>
          </div>

          <button style={btnStyle} disabled={loading} onClick={handleDownload}>
            {loading ? "Downloading..." : "Start Download"}
          </button>

          {/* Real-time Progress Bar */}
          {loading && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", color: "#475569", marginBottom: 6 }}>
                <span>{progress.percentage}%</span>
                {progress.totalBytes > 0 && (
                  <span>
                    {formatMB(progress.downloadedBytes)} MB / {formatMB(progress.totalBytes)} MB
                  </span>
                )}
              </div>
              <div style={{ width: "100%", height: 10, backgroundColor: "#e2e8f0", borderRadius: 5, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${progress.percentage}%`,
                    height: "100%",
                    backgroundColor: "#0284c7",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {status && (
        <div
          style={{
            marginTop: 15,
            padding: 10,
            borderRadius: 4,
            backgroundColor: status.type === "error" ? "#fee2e2" : status.type === "success" ? "#dcfce7" : "#e0f2fe",
            color: status.type === "error" ? "#991b1b" : status.type === "success" ? "#166534" : "#075985",
            fontSize: "0.9rem",
          }}
        >
          {status.text}
        </div>
      )}
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: 4,
  fontWeight: 600,
  fontSize: "0.9rem",
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 12px",
  marginBottom: 12,
  borderRadius: 4,
  border: "1px solid #cbd5e1",
  outline: "none",
};

const btnStyle: CSSProperties = {
  width: "100%",
  padding: "10px",
  backgroundColor: "#0284c7",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontWeight: "bold",
  fontSize: "0.95rem",
};