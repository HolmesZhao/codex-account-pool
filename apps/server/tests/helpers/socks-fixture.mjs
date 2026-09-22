import net from "node:net";

export async function socksFixture({ auth = false, rejectAuth = false, rejectConnect = false } = {}) {
  const requests = [], sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
    let buffer = Buffer.alloc(0), state = "hello", authenticated = false;
    socket.on("data", data => {
      buffer = Buffer.concat([buffer, data]);
      while (true) {
        if (state === "hello") {
          if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
          buffer = buffer.subarray(2 + buffer[1]); socket.write(Buffer.from([5, auth ? 2 : 0])); state = auth ? "auth" : "connect";
        } else if (state === "auth") {
          if (buffer.length < 2 || buffer.length < 3 + buffer[1]) return;
          const ulen = buffer[1], plen = buffer[2 + ulen]; if (buffer.length < 3 + ulen + plen) return;
          authenticated = buffer.subarray(2, 2 + ulen).toString() === "probe" && buffer.subarray(3 + ulen, 3 + ulen + plen).toString() === "p@ss";
          buffer = buffer.subarray(3 + ulen + plen);
          if (!authenticated || rejectAuth) { socket.end(Buffer.from([1, 1])); return; }
          socket.write(Buffer.from([1, 0])); state = "connect";
        } else if (state === "connect") {
          if (buffer.length < 5) return;
          if (buffer[3] !== 3) { socket.destroy(); return; }
          const len = buffer[4]; if (buffer.length < 7 + len) return;
          requests.push({ host: buffer.subarray(5, 5 + len).toString(), port: buffer.readUInt16BE(5 + len), authenticated });
          buffer = buffer.subarray(7 + len);
          if (rejectConnect) { socket.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])); return; }
          // Deliberately split the handshake reply; stream chunk boundaries are arbitrary.
          socket.write(Buffer.from([5, 0]));
          setTimeout(() => { if (!socket.destroyed) socket.write(Buffer.from([0, 1, 0, 0, 0, 0, 0, 0])); }, 5);
          state = "echo";
        } else {
          if (buffer.length) socket.write(buffer);
          buffer = Buffer.alloc(0); return;
        }
      }
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { requests, url: `socks5://${auth ? 'probe:p%40ss@' : ''}127.0.0.1:${server.address().port}`, async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
