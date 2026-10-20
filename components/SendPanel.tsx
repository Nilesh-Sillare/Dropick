"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, FileUp } from "lucide-react";
import { generateCode } from "@/lib/code";
import { formatBytes } from "@/lib/format";
import {
  startSending,
  type FileInfo,
  type RoomStatus,
  type SenderFileState,
  type SenderRoom,
} from "@/lib/transfer";

type Row = FileInfo & { state: SenderFileState; progress: number };

const LABELS: Record<SenderFileState, string> = {
  offered: "Waiting for the receiver",
  queued: "Queued",
  sending: "Sending",
  sent: "Sent ✓",
  declined: "Declined",
  error: "Failed",
};

export default function SendPanel({ onBack }: { onBack: () => void }) {
  const [session, setSession] = useState(0);
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<RoomStatus>("waiting");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const roomRef = useRef<SenderRoom | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let room: SenderRoom | undefined;
    // The setTimeout stops React dev mode from starting the room twice
    const t = setTimeout(() => {
      const newCode = generateCode();
      setCode(newCode);
      room = startSending(newCode, {
        onStatus: (s, msg) => {
          setStatus(s);
          if (msg) setError(msg);
        },
        onFileState: (id, state, progress) =>
          setRows((prev) =>
            prev.map((r) =>
              r.id === id ? { ...r, state, progress: progress ?? r.progress } : r
            )
          ),
      });
      roomRef.current = room;
    }, 0);
    return () => {
      clearTimeout(t);
      room?.stop();
      roomRef.current = null;
    };
  }, [session]);

  function newRoom() {
    setCode(null);
    setStatus("waiting");
    setError("");
    setRows([]);
    setSession((s) => s + 1);
  }

  function addFiles(list: FileList | null) {
    if (!list || !roomRef.current) return;
    const infos = roomRef.current.addFiles(Array.from(list));
    if (!infos.length) return;
    setRows((prev) => [
      ...prev,
      ...infos.map((i) => ({ ...i, state: "offered" as const, progress: 0 })),
    ]);
  }

  async function copyCode() {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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

      <div className="glass rounded-3xl p-6">
        {/* Room code */}
        <div className="text-center">
          <p className="mb-2 text-xs uppercase tracking-widest text-muted">
            Room code
          </p>
          <div className="flex items-center justify-center gap-3">
            <span
              className={`pl-[0.35em] font-bold tracking-[0.35em] ${
                connected ? "text-2xl" : "text-4xl"
              }`}
            >
              {code ?? "······"}
            </span>
            {code && (
              <button
                type="button"
                onClick={copyCode}
                aria-label="Copy code"
                className="rounded-lg border border-border p-2 transition hover:border-accent-1"
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
            )}
          </div>
        </div>

        {/* Status */}
        <div className="mt-5 flex flex-col items-center gap-3 text-center text-sm">
          {status === "waiting" && (
            <p className="flex items-center gap-2 text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent-1" />
              Waiting for the receiver to join…
            </p>
          )}
          {status === "connecting" && (
            <p className="flex items-center gap-2 text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent-2" />
              Receiver found. Connecting…
            </p>
          )}
          {connected && (
            <p className="flex items-center gap-2 text-muted">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Connected. Add files to share.
            </p>
          )}
          {(status === "closed" || status === "error") && (
            <>
              <p className="text-accent-3">{error}</p>
              <button
                type="button"
                onClick={newRoom}
                className="btn-gradient rounded-lg px-4 py-2"
              >
                Create a new room
              </button>
            </>
          )}
        </div>

        {/* Add files */}
        {connected && (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            className={`mt-6 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
              dragging
                ? "border-accent-1 bg-accent-1/10"
                : "border-border hover:border-accent-2"
            }`}
          >
            <FileUp size={24} className="text-accent-1" />
            <p className="font-semibold">Drop files here</p>
            <p className="text-sm text-muted">
              or click to choose. The receiver decides what to download.
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {/* File list */}
        {rows.length > 0 && (
          <ul className="mt-4 space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-muted">{formatBytes(r.size)}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted">
                    {r.state === "sending" ? `${r.progress}%` : LABELS[r.state]}
                  </span>
                </div>
                {r.state === "sending" && (
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