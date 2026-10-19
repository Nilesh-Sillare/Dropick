"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  FileUp,
  X,
} from "lucide-react";
import { generateCode } from "@/lib/code";
import { formatBytes } from "@/lib/format";
import {
  startSending,
  type SendFileState,
  type Status,
} from "@/lib/transfer";

type Item = {
  id: string;
  name: string;
  size: number;
  state: SendFileState;
  progress: number;
};

export default function SendPanel({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("waiting");
  const [error, setError] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<ReturnType<typeof startSending> | null>(null);

  // The code is created as soon as this screen opens, no file needed yet
  useEffect(() => {
    // The setTimeout stops React dev mode from starting the connection twice
    const t = setTimeout(() => {
      const newCode = generateCode();
      setCode(newCode);
      controlsRef.current = startSending(newCode, {
        onStatus: (s, msg) => {
          setStatus(s);
          if (msg) setError(msg);
        },
        onFileState: (id, state) =>
          setItems((list) =>
            list.map((it) => (it.id === id ? { ...it, state } : it))
          ),
        onProgress: (id, sent, total) =>
          setItems((list) =>
            list.map((it) =>
              it.id === id
                ? {
                    ...it,
                    progress: total ? Math.round((sent / total) * 100) : 100,
                  }
                : it
            )
          ),
      });
    }, 0);
    return () => {
      clearTimeout(t);
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, []);

  function addFiles(list: FileList | null | undefined) {
    if (!list || !controlsRef.current) return;
    const added: Item[] = [];
    for (const f of Array.from(list)) {
      const id = controlsRef.current.offerFile(f);
      added.push({
        id,
        name: f.name,
        size: f.size,
        state: "offered",
        progress: 0,
      });
    }
    setItems((l) => [...l, ...added]);
  }

  function removeItem(id: string) {
    controlsRef.current?.removeFile(id);
    setItems((l) => l.filter((it) => it.id !== id));
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

      <div className="glass flex flex-col items-center gap-6 rounded-3xl p-6 text-center">
        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-muted">
            Share this code
          </p>
          <div className="flex items-center gap-3">
            <span className="text-gradient pl-[0.35em] text-4xl font-bold tracking-[0.35em]">
              {code ?? "······"}
            </span>
            <button
              type="button"
              onClick={copyCode}
              aria-label="Copy code"
              className="rounded-lg border border-border p-2 transition hover:border-accent-1"
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </button>
          </div>
        </div>

        {/* Connection status */}
        {status === "waiting" && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent-1" />
            Waiting for the receiver to join…
          </p>
        )}
        {status === "connecting" && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent-2" />
            Receiver found. Connecting…
          </p>
        )}
        {connected && (
          <p className="flex items-center gap-2 text-sm text-accent-1">
            <CheckCircle2 size={18} /> Receiver connected. Add files to share.
          </p>
        )}
        {status === "error" && (
          <p className="text-sm text-accent-3">{error}</p>
        )}

        {/* Drop zone appears once connected */}
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
            className={`flex w-full cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
              dragging
                ? "border-accent-1 bg-accent-1/10"
                : "border-border hover:border-accent-2"
            }`}
          >
            <FileUp size={28} className="text-accent-1" />
            <p className="font-semibold">Drop files here</p>
            <p className="text-sm text-muted">or click to choose</p>
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

        {/* Shared files */}
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
                      {formatBytes(it.size)} ·{" "}
                      {it.state === "offered" && "Shared, waiting for receiver"}
                      {it.state === "queued" && "Requested, in queue"}
                      {it.state === "sending" && `Sending… ${it.progress}%`}
                      {it.state === "sent" && "Sent"}
                    </p>
                  </div>
                  {it.state !== "sending" && (
                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      aria-label="Stop sharing this file"
                      className="rounded-lg p-1 text-muted transition hover:text-foreground"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                {it.state === "sending" && (
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