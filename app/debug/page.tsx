"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getIceServers } from "@/lib/ice";

export default function DebugPage() {
  const [log, setLog] = useState<string[]>([]);
  const [myId, setMyId] = useState("");
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const idRef = useRef("");

  const add = (msg: string) =>
    setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${msg}`]);

  // What this build of the site knows (no secrets are shown)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const hasTurnUser = Boolean(process.env.NEXT_PUBLIC_TURN_USERNAME);
  const hasTurnPass = Boolean(process.env.NEXT_PUBLIC_TURN_CREDENTIAL);

  let host = "MISSING";
  try {
    if (supabaseUrl) host = new URL(supabaseUrl).host;
  } catch {
    host = "INVALID URL";
  }

  useEffect(() => {
    const id = Math.random().toString(36).slice(2, 6);
    idRef.current = id;
    setMyId(id);
    let channel: ReturnType<typeof supabase.channel> | undefined;

    // setTimeout avoids a double-start in React dev mode
    const t = setTimeout(() => {
      channel = supabase.channel("dropick-debug", {
        config: { broadcast: { self: false } },
      });
      channelRef.current = channel;
      channel
        .on("broadcast", { event: "ping" }, ({ payload }) => {
          add(`Received ping from ${payload.from} ✅`);
          channel?.send({
            type: "broadcast",
            event: "pong",
            payload: { to: payload.from, from: id, t: payload.t },
          });
        })
        .on("broadcast", { event: "pong" }, ({ payload }) => {
          if (payload.to === id) {
            add(`Got reply from ${payload.from} in ${Date.now() - payload.t} ms ✅`);
          }
        })
        .subscribe((status) => add(`Channel status: ${status}`));
    }, 0);

    return () => {
      clearTimeout(t);
      if (channel) supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, []);

  function sendPing() {
    const ch = channelRef.current;
    if (!ch) {
      add("Channel not ready yet");
      return;
    }
    add("Ping sent. Waiting for another tab or device…");
    ch.send({
      type: "broadcast",
      event: "ping",
      payload: { from: idRef.current, t: Date.now() },
    });
  }

  // Asks the TURN relay for an address, using ONLY the relay.
  async function testTurn() {
    const servers = getIceServers();
    if (servers.length < 2) {
      add("TURN: username or password is missing in this build ❌");
      return;
    }
    add("TURN: testing the relay (8 seconds)…");
    const pc = new RTCPeerConnection({
      iceServers: servers,
      iceTransportPolicy: "relay",
    });
    pc.createDataChannel("test");
    let gotRelay = false;
    pc.onicecandidate = (e) => {
      if (e.candidate && e.candidate.type === "relay") {
        gotRelay = true;
        add("TURN: relay address obtained ✅ (login works)");
      }
    };
    pc.onicecandidateerror = (e) => {
      const ev = e as RTCPeerConnectionIceErrorEvent;
      add(`TURN: error ${ev.errorCode} ${ev.errorText} (${ev.url})`);
    };
    await pc.setLocalDescription(await pc.createOffer());
    setTimeout(() => {
      if (!gotRelay) add("TURN: no relay address after 8 seconds ❌");
      pc.close();
    }, 8000);
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <h1 className="text-2xl font-bold">Dropick debug</h1>

      <div className="glass mt-6 space-y-1 rounded-2xl p-4 text-sm">
        <p>Supabase host: <b>{host}</b></p>
        <p>Supabase key present: <b>{hasKey ? "yes" : "NO"}</b></p>
        <p>TURN username present: <b>{hasTurnUser ? "yes" : "NO"}</b></p>
        <p>TURN password present: <b>{hasTurnPass ? "yes" : "NO"}</b></p>
        <p>This tab&apos;s ID: <b>{myId}</b></p>
      </div>

      <div className="mt-4 flex gap-3">
        <button onClick={sendPing} className="btn-gradient rounded-lg px-4 py-2 text-sm">
          Send ping
        </button>
        <button onClick={testTurn} className="btn-gradient rounded-lg px-4 py-2 text-sm">
          Test TURN relay
        </button>
      </div>

      <pre className="glass mt-4 min-h-40 whitespace-pre-wrap rounded-2xl p-4 text-xs">
        {log.join("\n") || "Waiting…"}
      </pre>
    </main>
  );
}