"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, Download } from "lucide-react";
import { startReceiving, type FileMeta, type Status } from "@/lib/transfer";
import { formatBytes } from "@/lib/format";

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
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ url: string; name: string } | null>(
    null
  );

  useEffect(() => {
    let stop: (() => void) | undefined;
    // The setTimeout stops React dev mode from starting the connection twice
    const t = setTimeout(() => {
      stop = startReceiving(code, {
        onStatus: (s, msg) => {
          setStatus(s);
          if (msg) setError(msg);
        },
        onMeta: setMeta,
        onProgress: (got, total) =>
          setProgress(total ? Math.round((got / total) * 100) : 100),
        onComplete: (blob, name) => {
          const url = URL.createObjectURL(blob);
          setResult({ url, name });
          triggerDownload(url, name);
        },
      });
    }, 0);
    return () => {
      clearTimeout(t);
      stop?.();
    };
  }, [code]);

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
            Joining
          </p>
          <span className="text-gradient pl-[0.35em] text-4xl font-bold tracking-[0.35em]">
            {code}
          </span>
        </div>

        {meta && (
          <div className="max-w-full">
            <p className="truncate font-semibold">{meta.name}</p>
            <p className="text-sm text-muted">{formatBytes(meta.size)}</p>
          </div>
        )}

        {status === "connecting" && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent-2" />
            Looking for the sender…
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
            <p className="mt-2 text-sm text-muted">Receiving… {progress}%</p>
          </div>
        )}

        {status === "done" && result && (
          <>
            <p className="flex items-center gap-2 text-sm text-accent-1">
              <CheckCircle2 size={18} /> File received
            </p>
            <button
              type="button"
              onClick={() => triggerDownload(result.url, result.name)}
              className="btn-gradient flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
            >
              <Download size={16} /> Download again
            </button>
          </>
        )}

        {status === "error" && (
          <p className="flex items-center gap-2 text-sm text-accent-3">
            <AlertCircle size={18} /> {error}
          </p>
        )}
      </div>
    </div>
  );
}