"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { formatBytes } from "@/lib/format";
import {
  startReceiving,
  type FileInfo,
  type ReceiverFileState,
  type ReceiverRoom,
  type RoomStatus,
} from "@/lib/transfer";

type Row = FileInfo & { state: ReceiverFileState; progress: number };

const LARGE_FILE = 500 * 1024 * 1024; // warn above 500 MB

const LABELS: Record<ReceiverFileState, string> = {
  offered: "",
  requested: "Waiting for the sender…",
  receiving: "Receiving",
  done: "Saved ✓",
  declined: "Declined",
  error: "Failed",
};

function triggerDownload(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function ReceivePanel({
  code,
  onBack,
}: {
  code: string;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<RoomStatus>("connecting");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const roomRef = useRef<ReceiverRoom | null>(null);

  useEffect(() => {
    let room: ReceiverRoom | undefined;
    // The setTimeout stops React dev mode from joining twice
    const t = setTimeout(() => {
      room = startReceiving(code, {
        onStatus: (s, msg) => {
          setStatus(s);
          if (msg) setError(msg);
        },
        onOffer: (list) =>
          setRows((prev) => [
            ...prev,
            ...list
              .filter((f) => !prev.some((p) => p.id === f.id))
              .map((f) => ({ ...f, state: "offered" as const, progress: 0 })),
          ]),
        onFileState: (id, state, progress) =>
          setRows((prev) =>
            prev.map((r) =>
              r.id === id ? { ...r, state, progress: progress ?? r.progress } : r
            )
          ),
        onFileComplete: (id, blob, name) => {
          const url = URL.createObjectURL(blob);
          setUrls((u) => ({ ...u, [id]: url }));
          triggerDownload(url, name);
        },
      });
      roomRef.current = room;
    }, 0);
    return () => {
      clearTimeout(t);
      room?.stop();
      roomRef.current = null;
    };
  }, [code]);

  const offered = rows.filter((r) => r.state === "offered");
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

      <div className="glass rounded-3xl p-6">
        <div className="text-center">
          <p className="mb-2 text-xs uppercase tracking-widest text-muted">
            Room code
          </p>
          <span
            className={`pl-[0.35em] font-bold tracking-[0.35em] ${
              connected ? "text-2xl" : "text-4xl"
            }`}
          >
            {code}
          </span>
        </div>

        <div className="mt-5 flex flex-col items-center gap-3 text-center text-sm">
          {status === "connecting" && (
            <p className="flex items-center gap-2 text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent-2" />
              Looking for the room…
            </p>
          )}
          {connected && (
            <p className="flex items-center gap-2 text-muted">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              {rows.length === 0
                ? "Connected. Waiting for the sender to share files…"
                : "Connected to the sender"}
            </p>
          )}
          {(status === "closed" || status === "error") && (
            <p className="text-accent-3">{error}</p>
          )}
        </div>

        {offered.length > 1 && (
          <button
            type="button"
            onClick={() => offered.forEach((r) => roomRef.current?.request(r.id))}
            className="btn-gradient mx-auto mt-5 flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
          >
            <Download size={16} /> Download all ({offered.length})
          </button>
        )}

        {rows.length > 0 && (
          <ul className="mt-4 space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-muted">
                      {formatBytes(r.size)}
                      {r.size > LARGE_FILE && " · large file, kept in memory"}
                    </p>
                  </div>

                  {r.state === "offered" && connected && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => roomRef.current?.request(r.id)}
                        className="btn-gradient rounded-lg px-3 py-1.5 text-xs"
                      >
                        Download
                      </button>
                      <button
                        type="button"
                        onClick={() => roomRef.current?.decline(r.id)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition hover:text-foreground"
                      >
                        Decline
                      </button>
                    </div>
                  )}

                  {r.state === "done" && urls[r.id] ? (
                    <button
                      type="button"
                      onClick={() => triggerDownload(urls[r.id], r.name)}
                      className="shrink-0 text-xs text-muted underline transition hover:text-foreground"
                    >
                      Saved ✓ · save again
                    </button>
                  ) : (
                    r.state !== "offered" && (
                      <span className="shrink-0 text-xs text-muted">
                        {r.state === "receiving"
                          ? `${r.progress}%`
                          : LABELS[r.state]}
                      </span>
                    )
                  )}
                </div>

                {r.state === "receiving" && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="btn-gradient h-full rounded-full transition-all"
                      style={{ width: `${r.progress}%` }}
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