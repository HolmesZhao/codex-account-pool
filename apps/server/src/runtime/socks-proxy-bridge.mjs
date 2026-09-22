import http from "node:http";
import net from "node:net";

// Codex's pinned HTTP client sends CONNECT even for SOCKS URLs. Translate locally.
export async function startSocksProxyBridge(proxyUrl) {
  const proxy = new URL(proxyUrl);
  const username = decodeURIComponent(proxy.username);
  const password = decodeURIComponent(proxy.password);
  if (Buffer.byteLength(username) > 255 || Buffer.byteLength(password) > 255) throw new Error("SOCKS5 用户名和密码不能超过 255 字节");
  const sockets = new Set();
  const track = (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.on("error", () => {}); return socket; };
  const server = http.createServer((_request, response) => response.writeHead(405).end());
  server.on("connection", track);
  server.on("connect", async (request, downstream, head) => {
    let upstream;
    try {
      const target = new URL(`http://${request.url}`);
      if (target.username || target.password || target.pathname !== "/" || target.search || target.hash) throw new Error("Invalid CONNECT target");
      const host = target.hostname.replace(/^\[|\]$/g, "");
      const port = Number(target.port || 80);
      const hostBytes = Buffer.from(host);
      if (!hostBytes.length || hostBytes.length > 255 || !port) throw new Error("Invalid CONNECT target");
      upstream = track(net.createConnection({ host: proxy.hostname.replace(/^\[|\]$/g, ""), port: Number(proxy.port || 1080) }));
      downstream.once("close", () => upstream.destroy());
      upstream.setTimeout(10_000, () => upstream.destroy(new Error("SOCKS5 handshake timeout")));
      await connected(upstream);
      const authenticated = Boolean(username || password);
      upstream.write(Buffer.from(authenticated ? [5, 1, 2] : [5, 1, 0]));
      const greeting = await readExactly(upstream, 2);
      if (greeting[0] !== 5 || greeting[1] !== (authenticated ? 2 : 0)) throw new Error("SOCKS5 authentication method rejected");
      if (authenticated) {
        const userBytes = Buffer.from(username), passwordBytes = Buffer.from(password);
        upstream.write(Buffer.concat([Buffer.from([1, userBytes.length]), userBytes, Buffer.from([passwordBytes.length]), passwordBytes]));
        const auth = await readExactly(upstream, 2);
        if (auth[0] !== 1 || auth[1] !== 0) throw new Error("SOCKS5 authentication failed");
      }
      // Domain address type keeps DNS resolution at the proxy.
      const portBytes = Buffer.alloc(2); portBytes.writeUInt16BE(port);
      upstream.write(Buffer.concat([Buffer.from([5, 1, 0, 3, hostBytes.length]), hostBytes, portBytes]));
      const reply = await readExactly(upstream, 4);
      if (reply[0] !== 5 || reply[1] !== 0) throw new Error("SOCKS5 connection rejected");
      const addressLength = reply[3] === 1 ? 4 : reply[3] === 4 ? 16 : reply[3] === 3 ? (await readExactly(upstream, 1))[0] : 0;
      if (!addressLength) throw new Error("Invalid SOCKS5 reply");
      await readExactly(upstream, addressLength + 2);
      upstream.setTimeout(0);
      if (downstream.destroyed) { upstream.destroy(); return; }
      downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.once("close", () => downstream.destroy());
      upstream.pipe(downstream); downstream.pipe(upstream);
    } catch {
      upstream?.destroy();
      if (!downstream.destroyed) downstream.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); },
  };
}
function connected(socket) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { socket.off("connect", ready); socket.off("error", fail); socket.off("close", closed); };
    const ready = () => { cleanup(); resolve(); };
    const fail = (error) => { cleanup(); reject(error); };
    const closed = () => fail(new Error("SOCKS5 connection closed"));
    socket.once("connect", ready); socket.once("error", fail); socket.once("close", closed);
  });
}
function readExactly(socket, size) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { socket.off("readable", read); socket.off("error", fail); socket.off("end", closed); socket.off("close", closed); };
    const fail = (error) => { cleanup(); reject(error); };
    const closed = () => fail(new Error("SOCKS5 connection closed"));
    const read = () => {
      const value = socket.read(size);
      if (value !== null) { cleanup(); resolve(value); }
      else if (socket.destroyed || socket.readableEnded) closed();
    };
    socket.on("readable", read); socket.once("error", fail); socket.once("end", closed); socket.once("close", closed); read();
  });
}
