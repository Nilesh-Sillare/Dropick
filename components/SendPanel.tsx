"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, Copy, FileUp } from "lucide-react";
import { generateCode } from "@/lib/code";
import { formatBytes } from "@/lib/format";
import { startSending, type Status } from "@/lib/transfer";

export default function SendPanel({ onBack }: { onBack: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>("waiting");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef<(() => void) | null>(null);

  // Stop everything when leaving this screen
  useEffect(() => {
    return () => stopRef.current?.();
  }, []);

  function pickFile(f: File | undefined) {
    if (!f) return;
    stopRef.current?.();
    const newCode = generateCode();
    setFile(f);
    setCode(newCode);
    setStatus("waiting");
    setError("");
    setProgress(0);
    stopRef.current = startSending(newCode, f, {
      onStatus: (s, msg) => {
        setStatus(s);
        if (msg) setError(msg);
      },
      onProgress: (sent, total) =>
        setProgress(total ? Math.round((sent / total) * 100) : 100),
    });
  }

  async function copyCode() {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function reset() {
    stopRef.current?.();
    stopRef.current = null;
    setFile(null);
    setCode(null);
    setStatus("waiting");
  }

  function goBack() {
    reset();
    onBack();
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-lg text-left">
      <button
        type="button"
        onClick={goBack}
        className="mb-4 flex items-center gap-2 text-sm text-muted transition hover:text-foreground"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div className="glass rounded-3xl p-6">
        {!file ? (
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
              pickFile(e.dataTransfer.files[0]);
            }}
            className={`flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition ${
              dragging
                ? "border-accent-1 bg-accent-1/10"
                : "border-border hover:border-accent-2"
            }`}
          >
            <FileUp size={28} className="text-accent-1" />
            <p className="font-semibold">Drop a file here</p>
            <p className="text-sm text-muted">or click to choose one</p>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="max-w-full">
              <p className="truncate font-semibold">{file.name}</p>
              <p className="text-sm text-muted">{formatBytes(file.size)}</p>
            </div>

            <div>
              <p className="mb-2 text-xs uppercase tracking-widest text-muted">
                Share this code
              </p>
              <div className="flex items-center gap-3">
                <span className="text-gradient pl-[0.35em] text-4xl font-bold tracking-[0.35em]">
                  {code}
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

            {/* Live status */}
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
            {status === "transferring" && (
              <div className="w-full">
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="btn-gradient h-full rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-muted">Sending… {progress}%</p>
              </div>
            )}
            {status === "done" && (
              <p className="flex items-center gap-2 text-sm text-accent-1">
                <CheckCircle2 size={18} /> File sent successfully
              </p>
            )}
            {status === "error" && (
              <p className="text-sm text-accent-3">{error}</p>
            )}

            <button
              type="button"
              onClick={reset}
              className="text-sm text-muted underline transition hover:text-foreground"
            >
              {status === "done" ? "Send another file" : "Choose a different file"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}