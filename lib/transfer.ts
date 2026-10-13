import { supabase } from "./supabase";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};
const CHUNK_SIZE = 16 * 1024; // 16 KB pieces
const MAX_BUFFERED = 1024 * 1024; // pause sending if 1 MB is queued

export type Status =
  | "waiting"
  | "connecting"
  | "transferring"
  | "done"
  | "error";

export type FileMeta = { name: string; size: number; mime: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function openChannel(code: string) {
  return supabase.channel(`dropick-${code}`, {
    config: { broadcast: { self: false } },
  });
}
type Channel = ReturnType<typeof openChannel>;

// Creates the WebRTC connection and handles passing connection details
// ("ICE candidates") back and forth through the Supabase channel.
function createPeer(channel: Channel, onFail: () => void) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
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

type SendHandlers = {
  onStatus: (s: Status, msg?: string) => void;
  onProgress: (sent: number, total: number) => void;
};

export function startSending(code: string, file: File, h: SendHandlers) {
  const channel = openChannel(code);
  let peer: ReturnType<typeof createPeer> | null = null;
  let dc: RTCDataChannel | null = null;
  let finished = false;

  const fail = (msg: string) => {
    if (finished) return;
    finished = true;
    h.onStatus("error", msg);
  };

  async function pump(ch: RTCDataChannel) {
    h.onStatus("transferring");
    h.onProgress(0, file.size);
    ch.send(
      JSON.stringify({
        type: "meta",
        name: file.name,
        size: file.size,
        mime: file.type,
      })
    );
    ch.bufferedAmountLowThreshold = MAX_BUFFERED / 4;

    let offset = 0;
    while (offset < file.size) {
      if (ch.bufferedAmount > MAX_BUFFERED) {
        await new Promise<void>((resolve) => {
          ch.onbufferedamountlow = () => {
            ch.onbufferedamountlow = null;
            resolve();
          };
        });
      }
      const buf = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
      ch.send(buf);
      offset += buf.byteLength;
      h.onProgress(offset, file.size);
    }

    ch.send(JSON.stringify({ type: "done" }));
    while (ch.bufferedAmount > 0) await sleep(50);
    finished = true;
    h.onStatus("done");
  }

  channel
    // The receiver typed our code and joined -> we start the connection
    .on("broadcast", { event: "join" }, async () => {
      if (peer) return;
      h.onStatus("connecting");
      const p = createPeer(channel, () =>
        fail("Connection failed. Your network may be blocking direct connections.")
      );
      peer = p;

      dc = p.pc.createDataChannel("file");
      dc.binaryType = "arraybuffer";
      dc.onopen = () => {
        pump(dc!).catch(() => fail("Transfer was interrupted."));
      };
      dc.onclose = () => fail("The receiver disconnected.");

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
        fail("Could not reach the signaling server. Check your Supabase keys.");
      }
    });

  // Call this to stop everything (back button, new file, leaving the page)
  return () => {
    finished = true;
    dc?.close();
    peer?.pc.close();
    supabase.removeChannel(channel);
  };
}

/* ----------------------------- RECEIVER ----------------------------- */

type ReceiveHandlers = {
  onStatus: (s: Status, msg?: string) => void;
  onMeta: (m: FileMeta) => void;
  onProgress: (received: number, total: number) => void;
  onComplete: (blob: Blob, name: string) => void;
};

export function startReceiving(code: string, h: ReceiveHandlers) {
  const channel = openChannel(code);
  let peer: ReturnType<typeof createPeer> | null = null;
  let meta: FileMeta | null = null;
  const chunks: ArrayBuffer[] = [];
  let received = 0;
  let finished = false;

  const fail = (msg: string) => {
    if (finished) return;
    finished = true;
    h.onStatus("error", msg);
  };

  h.onStatus("connecting");

  const timeout = setTimeout(() => {
    if (!peer) {
      fail(
        "No sender found for that code. Check the code, and make sure the sender has already picked a file."
      );
    }
  }, 10000);

  function handleMessage(data: string | ArrayBuffer) {
    if (typeof data === "string") {
      const msg = JSON.parse(data);
      if (msg.type === "meta") {
        meta = { name: msg.name, size: msg.size, mime: msg.mime };
        h.onMeta(meta);
        h.onStatus("transferring");
        h.onProgress(0, meta.size);
      } else if (msg.type === "done") {
        finished = true;
        const blob = new Blob(chunks, {
          type: meta?.mime || "application/octet-stream",
        });
        h.onStatus("done");
        h.onComplete(blob, meta?.name ?? "dropick-file");
      }
    } else {
      chunks.push(data);
      received += data.byteLength;
      if (meta) h.onProgress(received, meta.size);
    }
  }

  channel
    .on("broadcast", { event: "offer" }, async ({ payload }) => {
      if (peer) return;
      clearTimeout(timeout);
      const p = createPeer(channel, () =>
        fail("Connection failed. Your network may be blocking direct connections.")
      );
      peer = p;

      p.pc.ondatachannel = (e) => {
        const ch = e.channel;
        ch.binaryType = "arraybuffer";
        ch.onmessage = (ev) => handleMessage(ev.data);
        ch.onclose = () => fail("The sender disconnected before the file finished.");
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
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Tell the sender "I'm here"
        channel.send({ type: "broadcast", event: "join", payload: {} });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        fail("Could not reach the signaling server. Check your Supabase keys.");
      }
    });

  return () => {
    finished = true;
    clearTimeout(timeout);
    peer?.pc.close();
    supabase.removeChannel(channel);
  };
}