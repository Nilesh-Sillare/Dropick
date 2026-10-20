import { supabase } from "./supabase";
import { getIceServers } from "./ice";

const MAX_CHUNK = 64 * 1024; // size of each piece sent
const BLOCK_SIZE = 1024 * 1024; // how much is read from disk at once
const MAX_BUFFERED = 1024 * 1024; // pause sending if 1 MB is queued

export type RoomStatus =
  | "waiting"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

export type FileInfo = { id: string; name: string; size: number; mime: string };

export type SenderFileState =
  | "offered"
  | "queued"
  | "sending"
  | "sent"
  | "declined"
  | "error";

export type ReceiverFileState =
  | "offered"
  | "requested"
  | "receiving"
  | "done"
  | "declined"
  | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function openChannel(code: string) {
  return supabase.channel(`dropick-${code}`, {
    config: { broadcast: { self: false } },
  });
}
type Channel = ReturnType<typeof openChannel>;

function sendJson(ch: RTCDataChannel, obj: object) {
  ch.send(JSON.stringify(obj));
}

// Waits until the send queue has space again (or the channel closes)
function waitForDrain(ch: RTCDataChannel) {
  return new Promise<void>((resolve) => {
    const done = () => {
      ch.removeEventListener("bufferedamountlow", done);
      ch.removeEventListener("close", done);
      resolve();
    };
    ch.addEventListener("bufferedamountlow", done);
    ch.addEventListener("close", done);
  });
}

// Creates the WebRTC connection and passes connection details
// ("ICE candidates") back and forth through the Supabase channel.
function createPeer(channel: Channel, onFail: () => void) {
  const pc = new RTCPeerConnection({ iceServers: getIceServers() });
  const pending: RTCIceCandidateInit[] = [];

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      channel.send({
        type: "broadcast",
        event: "ice",
        payload: { candidate: e.candidate.toJSON() },
      });
    }
  };
  pc.onconnectionstatechange = () => {
    console.log("[Dropick] connection state:", pc.connectionState);
    if (pc.connectionState === "failed") onFail();
  };

  async function addRemoteIce(c: RTCIceCandidateInit) {
    if (pc.remoteDescription) await pc.addIceCandidate(c);
    else pending.push(c);
  }
  async function flushIce() {
    for (const c of pending.splice(0)) await pc.addIceCandidate(c);
  }

  return { pc, addRemoteIce, flushIce };
}

/* ------------------------------ SENDER ------------------------------ */

export type SenderRoom = {
  addFiles: (list: File[]) => FileInfo[];
  stop: () => void;
};

type SenderHandlers = {
  onStatus: (s: RoomStatus, msg?: string) => void;
  onFileState: (id: string, state: SenderFileState, progress?: number) => void;
};

export function startSending(code: string, h: SenderHandlers): SenderRoom {
  const channel = openChannel(code);
  let peer: ReturnType<typeof createPeer> | null = null;
  let dc: RTCDataChannel | null = null;
  let connected = false;
  let ended = false;
  let sending = false;
  const files = new Map<string, File>();
  const requested = new Set<string>();
  const queue: string[] = [];

  function end(status: "closed" | "error", msg: string) {
    if (ended) return;
    ended = true;
    h.onStatus(status, msg);
  }

  function resetPeer() {
    dc?.close();
    peer?.pc.close();
    dc = null;
    peer = null;
  }

  async function sendFile(ch: RTCDataChannel, id: string, file: File) {
    const maxMsg = peer?.pc.sctp?.maxMessageSize;
    const chunk = maxMsg && maxMsg > 0 ? Math.min(MAX_CHUNK, maxMsg) : 16 * 1024;

    h.onFileState(id, "sending", 0);
    sendJson(ch, { type: "start", id });
    ch.bufferedAmountLowThreshold = MAX_BUFFERED / 4;

    let sent = 0;
    let lastPct = 0;
    for (let start = 0; start < file.size; start += BLOCK_SIZE) {
      const block = await file.slice(start, start + BLOCK_SIZE).arrayBuffer();
      for (let o = 0; o < block.byteLength; o += chunk) {
        if (ended || ch.readyState !== "open") throw new Error("closed");
        if (ch.bufferedAmount > MAX_BUFFERED) await waitForDrain(ch);
        const len = Math.min(chunk, block.byteLength - o);
        ch.send(new Uint8Array(block, o, len));
        sent += len;
        const pct = Math.floor((sent / file.size) * 100);
        if (pct !== lastPct) {
          lastPct = pct;
          h.onFileState(id, "sending", pct);
        }
      }
    }

    sendJson(ch, { type: "end", id });
    while (ch.bufferedAmount > 0 && ch.readyState === "open") await sleep(50);
    h.onFileState(id, "sent", 100);
  }

  // Sends the files the receiver asked for, one at a time
  async function processQueue() {
    if (sending) return;
    sending = true;
    while (queue.length && !ended) {
      const id = queue.shift()!;
      const file = files.get(id);
      const ch = dc;
      if (!file || !ch || ch.readyState !== "open") continue;
      try {
        await sendFile(ch, id, file);
      } catch {
        if (ended) break;
        h.onFileState(id, "error");
        if (ch.readyState === "open") sendJson(ch, { type: "abort", id });
      }
    }
    sending = false;
  }

  function handleMessage(data: unknown) {
    if (typeof data !== "string") return;
    let msg: { type: string; id?: string };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    const id = msg.id ?? "";
    if (msg.type === "request" && files.has(id) && !requested.has(id)) {
      requested.add(id);
      queue.push(id);
      h.onFileState(id, "queued");
      void processQueue();
    } else if (msg.type === "decline" && files.has(id)) {
      h.onFileState(id, "declined");
    }
  }

  channel
    .on("broadcast", { event: "join" }, async () => {
      if (ended) return;
      if (connected) {
        // Room already has a receiver
        channel.send({ type: "broadcast", event: "busy", payload: {} });
        return;
      }
      resetPeer(); // an earlier attempt that never connected: start over
      h.onStatus("connecting");

      const p = createPeer(channel, () =>
        end("error", "Connection failed. Your network may be blocking direct connections.")
      );
      peer = p;

      const ch = p.pc.createDataChannel("room");
      ch.binaryType = "arraybuffer";
      dc = ch;
      ch.onopen = () => {
        connected = true;
        h.onStatus("connected");
      };
      ch.onclose = () => {
        if (connected) end("closed", "The receiver left the room.");
      };
      ch.onmessage = (ev) => handleMessage(ev.data);

      const offer = await p.pc.createOffer();
      await p.pc.setLocalDescription(offer);
      channel.send({
        type: "broadcast",
        event: "offer",
        payload: { sdp: p.pc.localDescription },
      });
    })
    .on("broadcast", { event: "answer" }, async ({ payload }) => {
      if (!peer) return;
      await peer.pc.setRemoteDescription(payload.sdp);
      await peer.flushIce();
    })
    .on("broadcast", { event: "ice" }, async ({ payload }) => {
      await peer?.addRemoteIce(payload.candidate);
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        end("error", "Could not reach the signaling server. Check your Supabase keys.");
      }
    });

  return {
    // Announces files to the receiver. Nothing is sent until they accept.
    addFiles(list) {
      const ch = dc;
      if (!connected || !ch || ch.readyState !== "open") return [];
      const infos: FileInfo[] = list.map((f) => ({
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        name: f.name,
        size: f.size,
        mime: f.type,
      }));
      list.forEach((f, i) => files.set(infos[i].id, f));
      sendJson(ch, { type: "offer", files: infos });
      return infos;
    },
    stop() {
      ended = true;
      resetPeer();
      supabase.removeChannel(channel);
    },
  };
}

/* ----------------------------- RECEIVER ----------------------------- */

export type ReceiverRoom = {
  request: (id: string) => void;
  decline: (id: string) => void;
  stop: () => void;
};

type ReceiverHandlers = {
  onStatus: (s: RoomStatus, msg?: string) => void;
  onOffer: (files: FileInfo[]) => void;
  onFileState: (id: string, state: ReceiverFileState, progress?: number) => void;
  onFileComplete: (id: string, blob: Blob, name: string) => void;
};

export function startReceiving(code: string, h: ReceiverHandlers): ReceiverRoom {
  const channel = openChannel(code);
  let peer: ReturnType<typeof createPeer> | null = null;
  let dc: RTCDataChannel | null = null;
  let connected = false;
  let ended = false;
  const known = new Map<string, FileInfo>();
  let current: {
    id: string;
    chunks: ArrayBuffer[];
    received: number;
    lastPct: number;
  } | null = null;

  function end(status: "closed" | "error", msg: string) {
    if (ended) return;
    ended = true;
    h.onStatus(status, msg);
  }

  h.onStatus("connecting");

  const timeout = setTimeout(() => {
    if (!peer) {
      end(
        "error",
        "No room found for that code. Check the code, and make sure the sender has created the room."
      );
    }
  }, 10000);

  function handleMessage(data: string | ArrayBuffer) {
    if (typeof data === "string") {
      let msg: { type: string; id?: string; files?: FileInfo[] };
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      const id = msg.id ?? "";
      if (msg.type === "offer" && msg.files) {
        msg.files.forEach((f) => known.set(f.id, f));
        h.onOffer(msg.files);
      } else if (msg.type === "start") {
        current = { id, chunks: [], received: 0, lastPct: 0 };
        h.onFileState(id, "receiving", 0);
      } else if (msg.type === "end" && current && current.id === id) {
        const info = known.get(id);
        const blob = new Blob(current.chunks, {
          type: info?.mime || "application/octet-stream",
        });
        current = null;
        h.onFileComplete(id, blob, info?.name ?? "dropick-file");
        h.onFileState(id, "done", 100);
      } else if (msg.type === "abort") {
        if (current?.id === id) current = null;
        h.onFileState(id, "error");
      }
    } else if (current) {
      current.chunks.push(data);
      current.received += data.byteLength;
      const size = known.get(current.id)?.size ?? 0;
      const pct = size ? Math.min(99, Math.floor((current.received / size) * 100)) : 0;
      if (pct !== current.lastPct) {
        current.lastPct = pct;
        h.onFileState(current.id, "receiving", pct);
      }
    }
  }

  channel
    .on("broadcast", { event: "offer" }, async ({ payload }) => {
      if (peer || ended) return;
      clearTimeout(timeout);
      const p = createPeer(channel, () =>
        end("error", "Connection failed. Your network may be blocking direct connections.")
      );
      peer = p;

      p.pc.ondatachannel = (e) => {
        const ch = e.channel;
        ch.binaryType = "arraybuffer";
        dc = ch;
        const markOpen = () => {
          if (connected) return;
          connected = true;
          h.onStatus("connected");
        };
        if (ch.readyState === "open") markOpen();
        else ch.onopen = markOpen;
        ch.onmessage = (ev) => handleMessage(ev.data);
        ch.onclose = () =>
          end(connected ? "closed" : "error", "The sender left the room.");
      };

      await p.pc.setRemoteDescription(payload.sdp);
      await p.flushIce();
      const answer = await p.pc.createAnswer();
      await p.pc.setLocalDescription(answer);
      channel.send({
        type: "broadcast",
        event: "answer",
        payload: { sdp: p.pc.localDescription },
      });
    })
    .on("broadcast", { event: "ice" }, async ({ payload }) => {
      await peer?.addRemoteIce(payload.candidate);
    })
    .on("broadcast", { event: "busy" }, () => {
      if (peer) return; // we're the one in the room
      clearTimeout(timeout);
      end("error", "This room already has a receiver.");
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channel.send({ type: "broadcast", event: "join", payload: {} });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        end("error", "Could not reach the signaling server. Check your Supabase keys.");
      }
    });

  return {
    request(id) {
      if (dc?.readyState !== "open") return;
      sendJson(dc, { type: "request", id });
      h.onFileState(id, "requested");
    },
    decline(id) {
      if (dc?.readyState !== "open") return;
      sendJson(dc, { type: "decline", id });
      h.onFileState(id, "declined");
    },
    stop() {
      ended = true;
      clearTimeout(timeout);
      dc?.close();
      peer?.pc.close();
      supabase.removeChannel(channel);
    },
  };
}