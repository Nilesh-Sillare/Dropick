"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, Download } from "lucide-react";
import { startReceiving, type Status } from "@/lib/transfer";
import { formatBytes } from "@/lib/format";

function triggerDownload(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

type Item = {
  id: string;
  name: string;
  size: number;
  state: "available" | "requested" | "receiving" | "done";
  progress: number;
  url?: string;
};

export default function ReceivePanel({
  code,
  onBack,
}: {
  code: string;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const controlsRef = useRef<ReturnType<typeof startReceiving> | null>(null);
  const urlsRef = useRef<string[]>([]);

  function patch(id: string, changes: Partial<Item>) {
    setItems((list) =>
      list.map((it) => (it.id === id ? { ...it, ...changes } : it))
    );
  }

  useEffect(() => {
    // The setTimeout stops React dev mode from starting the connection twice
    const t = setTimeout(() => {
      controlsRef.current = startReceiving(code, {
        onStatus: (s, msg) => {
          setStatus(s);
          if (msg) setError(msg);
        },
        onOffer: (m) =>
          setItems((list) =>
            list.some((it) => it.id === m.id)
              ? list
              : [
                  ...list,
                  {
                    id: m.id,
                    name: m.name,
                    size: m.size,
                    state: "available",
                    progress: 0,
                  },
                ]
          ),
        onRemove: (id) =>
          setItems((list) =>
            list.filter((it) => !(it.id === id && it.state === "available"))
          ),
        onFileStart: (id) => patch(id, { state: "receiving", progress: 0 }),
        onProgress: (id, got, total) =>
          patch(id, {
            progress: total ? Math.round((got / total) * 100) : 100,
          }),
        onComplete: (id, blob, name) => {
          const url = URL.createObjectURL(blob);
          urlsRef.current.push(url);
          patch(id, { state: "done", progress: 100, url });
          triggerDownload(url, name);
        },
      });
    }, 0);
    return () => {
      clearTimeout(t);
      controlsRef.current?.stop();
      controlsRef.current = null;
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current = [];
    };
  }, [code]);

  function request(id: string) {
    controlsRef.current?.request(id);
    patch(id, { state: "requested" });
  }

  const connected = status === "connected";

  return (
    <div className="mx-auto mt-10 w-full max-w-lg text-left">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-2 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div className="glass flex flex-col items-center gap-6 rounded-3xl p-6 text-center">
        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-muted">
            Joined
          </p>
          <span className="text-gradient pl-[0.35em] text-4xl font-bold tracking-[0.35em]">
            {code}
          </span>
        </div>

        {status === "connecting" && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent-2" />
            Looking for the sender…
          </p>
        )}

        {connected && items.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent-1" />
            Connected. Waiting for the sender to share files…
          </p>
        )}

        {status === "error" && (
          <p className="flex items-center gap-2 text-sm text-accent-3">
            <AlertCircle size={18} /> {error}
          </p>
        )}

        {items.length > 0 && (
          <ul className="w-full space-y-2 text-left">
            {items.map((it) => (
              <li
                key={it.id}
                className="rounded-xl border border-border px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{it.name}</p>
                    <p className="text-xs text-muted">
                      {formatBytes(it.size)}
                      {it.state === "requested" && " · Waiting for sender…"}
                      {it.state === "receiving" && ` · Receiving… ${it.progress}%`}
                    </p>
                  </div>

                  {it.state === "available" && (
                    <button
                      type="button"
                      onClick={() => request(it.id)}
                      disabled={!connected}
                      className="btn-gradient flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      <Download size={14} /> Download
                    </button>
                  )}
                  {it.state === "done" && it.url && (
                    <button
                      type="button"
                      onClick={() => triggerDownload(it.url!, it.name)}
                      className="flex shrink-0 items-center gap-2 text-sm text-accent-1"
                    >
                      <CheckCircle2 size={16} /> Save again
                    </button>
                  )}
                </div>
                {it.state === "receiving" && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="btn-gradient h-full rounded-full transition-all"
                      style={{ width: `${it.progress}%` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}