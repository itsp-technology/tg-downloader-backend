import React, { useState } from "react";

interface Props {
  apiBase: string;
  onAuthorized: () => void;
  onLogout: () => void;
  isLoggedIn: boolean;
}

export const AuthCard: React.FC<Props> = ({ apiBase, onAuthorized, onLogout, isLoggedIn }) => {
  const [step, setStep] = useState<"credentials" | "code" | "2fa">("credentials");
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSendCode = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/api/auth/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiId, apiHash, phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.status === "AUTHORIZED") onAuthorized();
      else setStep("code");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/api/auth/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.status === "2FA_REQUIRED") setStep("2fa");
      else onAuthorized();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2FA = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/api/auth/verify-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onAuthorized();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (isLoggedIn) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f0fdf4", padding: "10px 16px", borderRadius: 6, marginBottom: 16 }}>
        <span style={{ color: "#166534", fontWeight: 600 }}>● Session Authenticated (Saved on Disk)</span>
        <button onClick={onLogout} style={{ background: "#ef4444", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 4, cursor: "pointer" }}>
          Disconnect / Switch Account
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: "#fff", padding: 20, borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Telegram Account Login</h3>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      {step === "credentials" && (
        <>
          <input placeholder="API ID" value={apiId} onChange={(e) => setApiId(e.target.value)} style={inputStyle} />
          <input placeholder="API Hash" value={apiHash} onChange={(e) => setApiHash(e.target.value)} style={inputStyle} />
          <input placeholder="Phone (+91...)" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
          <button onClick={handleSendCode} disabled={loading} style={btnStyle}>{loading ? "Sending..." : "Send Login Code"}</button>
        </>
      )}

      {step === "code" && (
        <>
          <input placeholder="Telegram Code" value={code} onChange={(e) => setCode(e.target.value)} style={inputStyle} />
          <button onClick={handleVerifyCode} disabled={loading} style={btnStyle}>{loading ? "Verifying..." : "Verify Code"}</button>
        </>
      )}

      {step === "2fa" && (
        <>
          <input type="password" placeholder="2FA Password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
          <button onClick={handleVerify2FA} disabled={loading} style={btnStyle}>{loading ? "Submitting..." : "Submit 2FA"}</button>
        </>
      )}
    </div>
  );
};

const inputStyle: React.CSSProperties = { width: "100%", padding: 8, boxSizing: "border-box", marginBottom: 10, borderRadius: 4, border: "1px solid #cbd5e1" };
const btnStyle: React.CSSProperties = { width: "100%", padding: 10, background: "#0284c7", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 };