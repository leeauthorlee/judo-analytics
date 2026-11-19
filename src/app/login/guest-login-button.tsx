"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GuestLoginButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/guest", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "게스트 로그인에 실패했습니다.");
      router.push("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "게스트 로그인에 실패했습니다.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="secondary-button" type="button" disabled={busy} onClick={() => void login()}>
        {busy ? "게스트 로그인 중…" : "게스트 로그인"}
      </button>
      {error && <p className="feedback error" role="alert">{error}</p>}
    </div>
  );
}
