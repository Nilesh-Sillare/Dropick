"use client";

import { useState } from "react";
import { Send, Upload, Download } from "lucide-react";
import SendPanel from "@/components/SendPanel";
import ReceivePanel from "@/components/ReceivePanel";

export default function Home() {
  const [mode, setMode] = useState<"home" | "send" | "receive">("home");
  const [code, setCode] = useState("");

  function goHome() {
    setMode("home");
    setCode("");
  }

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <button
          type="button"
          onClick={goHome}
          className="flex items-center gap-3"
        >
          <div className="btn-gradient flex h-9 w-9 items-center justify-center rounded-xl">
            <Send size={16} />
          </div>
          <span className="text-lg font-semibold">Dropick</span>
        </button>
        <span className="glass rounded-full px-3 py-1 text-xs text-muted">
          P2P · Encrypted · No uploads
        </span>
      </header>

      {/* Hero */}
      <section className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-24 text-center">
        <h1 className="text-5xl font-extrabold tracking-tight sm:text-6xl">
          Beam a file to <span className="text-gradient">any browser</span>
        </h1>
        <p className="mt-5 max-w-md text-muted">
          Dropick connects two browsers directly. Your file never touches a
          server — it travels peer to peer, end to end.
        </p>

        {mode === "send" && <SendPanel onBack={goHome} />}
        {mode === "receive" && <ReceivePanel code={code} onBack={goHome} />}

        {mode === "home" && (
          <div className="mt-12 grid w-full gap-4 text-left sm:grid-cols-2">
            {/* Send */}
            <button
              type="button"
              onClick={() => setMode("send")}
              className="glass rounded-3xl p-6 text-left transition hover:-translate-y-1 hover:shadow-[0_0_40px_-10px_var(--accent-2)]"
            >
              <div className="btn-gradient flex h-11 w-11 items-center justify-center rounded-xl">
                <Upload size={20} />
              </div>
              <h2 className="mt-8 font-semibold">Send a file</h2>
              <p className="mt-1 text-sm text-muted">
                Get a 6-character code to share
              </p>
            </button>

            {/* Receive */}
            <div className="glass rounded-3xl p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
                <Download size={20} />
              </div>
              <h2 className="mt-8 font-semibold">Receive a file</h2>
              <div className="mt-3 flex gap-2">
                <input
                  value={code}
                  onChange={(e) =>
                    setCode(
                      e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && code.length === 6)
                      setMode("receive");
                  }}
                  maxLength={6}
                  placeholder="CODE"
                  className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-center text-sm tracking-[0.3em] outline-none placeholder:text-muted focus:border-accent-1"
                />
                <button
                  type="button"
                  disabled={code.length !== 6}
                  onClick={() => setMode("receive")}
                  className="btn-gradient rounded-lg px-4 py-2 text-sm disabled:opacity-40"
                >
                  Join
                </button>
              </div>
            </div>
          </div>
        )}

        <p className="mt-10 text-xs text-muted">
          Both people must keep this tab open while the transfer runs.
        </p>
      </section>
    </main>
  );
}