import { createServer, IncomingMessage, ServerResponse } from "http";
import * as flatbuffers from "flatbuffers";
import { ConfigSnapshot } from "@ctc/sdk-ts";

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const PORT = Number(process.env.PORT ?? 7070);

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
      return;
    }
    if (req.method === "POST" && req.url === "/config") {
      const buf = await readBody(req);
      const bb = new flatbuffers.ByteBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      const snap = ConfigSnapshot.getRootAsConfigSnapshot(bb);
      const version = Number(snap.version());
      const instrumentsLen = snap.instrumentsLength();
      const etfLen = snap.etfLength();
      const optionsLen = snap.optionsLength();
      const limitsLen = snap.riskLimitsLength();
      // Minimal validation: non-zero version and at least one instrument
      if (!Number.isFinite(version) || instrumentsLen <= 0) {
        res.writeHead(400, { "content-type": "text/plain" }).end("bad snapshot\n");
        return;
      }
      console.log(
        `ConfigSnapshot v${version} received: inst=${instrumentsLen} etf=${etfLen} opt=${optionsLen} limits=${limitsLen}`,
      );
      res.writeHead(200).end("ok\n");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
  } catch (err: any) {
    console.error("/config error:", err);
    res.writeHead(500, { "content-type": "text/plain" }).end("error\n");
  }
});

server.listen(PORT, () => {
  console.log(`engine control listening on :${PORT}`);
});

