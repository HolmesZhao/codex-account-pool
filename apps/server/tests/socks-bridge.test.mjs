import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startSocksProxyBridge } from "../src/runtime/socks-proxy-bridge.mjs";
import { socksFixture } from "./helpers/socks-fixture.mjs";

for (const auth of [false, true]) test(`SOCKS5 bridge tunnels bytes with remote DNS, auth=${auth}`, async () => {
  const socks = await socksFixture({ auth });
  const bridge = await startSocksProxyBridge(socks.url);
  try {
    await new Promise((resolve, reject) => {
      const req = http.request(bridge.url, { method: "CONNECT", path: "unresolvable.example.invalid:443" });
      req.on("error", reject); req.setTimeout(3000, () => req.destroy(new Error("timeout")));
      req.on("connect", (response, socket) => {
        try { assert.equal(response.statusCode, 200); } catch (e) { socket.destroy(); reject(e); return; }
        const payload = Buffer.from([0, 1, 2, 255, 42]); let data = Buffer.alloc(0);
        socket.on("error", reject); socket.setTimeout(3000, () => socket.destroy(new Error("timeout")));
        socket.on("data", chunk => { data = Buffer.concat([data, chunk]); if (data.length >= payload.length) { try { assert.deepEqual(data, payload); resolve(); } catch (e) { reject(e); } socket.destroy(); } });
        socket.write(payload);
      }); req.end();
    });
    assert.deepEqual(socks.requests, [{ host: "unresolvable.example.invalid", port: 443, authenticated: auth }]);
  } finally { await bridge.close(); await socks.close(); }
});
for (const options of [{auth:true,rejectAuth:true},{rejectConnect:true}]) test(`SOCKS5 failures return 502 without direct fallback: ${JSON.stringify(options)}`, async () => {
  const socks = await socksFixture(options), bridge = await startSocksProxyBridge(socks.url);
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(bridge.url, { method:"CONNECT",path:"unresolvable.example.invalid:443" });
      req.on("error",reject);req.on("connect",(res,socket)=>{socket.destroy();resolve(res.statusCode);});req.end();
    });
    assert.equal(status,502);
  } finally {await bridge.close();await socks.close();}
});
