import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexRuntime } from "../src/runtime/codex-runtime.mjs";

test("app-server runtime supports Device Code and quota JSON-RPC", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-runtime-test-"));
  const command = join(directory, "fake-codex");
  await writeFile(command, `#!/usr/bin/env node
const fs=require('node:fs'); const readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',(line)=>{ const m=JSON.parse(line); if(m.id===undefined)return;
 if(m.method==='initialize') return reply(m.id,{});
 if(m.method==='account/read') return reply(m.id,{account:{type:'chatgpt',email:'device@example.com',planType:'pro'}});
 if(m.method==='account/login/start'){ reply(m.id,{loginId:'login-1',userCode:'ABCD-1234',verificationUrl:'https://example.test/device'}); setTimeout(()=>fs.writeFileSync(process.env.CODEX_HOME+'/auth.json',JSON.stringify({email:'device@example.com',tokens:{access_token:'at',refresh_token:'rt',id_token:'id'}})),40); return; }
 if(m.method==='account/rateLimits/read'){ if(!fs.existsSync(process.env.CODEX_HOME+'/auth.json')) return reply(m.id,null,{message:'missing auth'}); return reply(m.id,{ordinaryUsageAllowed:true,rateLimits:{primary:{usedPercent:42,windowDurationMins:300,resetsAt:4000000000},secondary:{usedPercent:18,windowDurationMins:10080},planType:'pro'}}); }
 if(m.method==='account/login/cancel') return reply(m.id,{});
}); function reply(id,result,error){process.stdout.write(JSON.stringify(error?{id,error}:{id,result})+'\\n');}
`, { mode: 0o700 });
  await chmod(command, 0o700);
  const runtime = new CodexRuntime({ command, timeoutMs: 5_000 });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });

  const handle = await runtime.beginLogin();
  assert.deepEqual(handle.publicState(), { status: "pending", userCode: "ABCD-1234", verificationUrl: "https://example.test/device", expiresAt: "" });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const completed = await handle.poll();
  assert.equal(completed.status, "complete");
  assert.equal(JSON.parse(completed.authJson).email, "device@example.com");
  await handle.close();

  const quota = await runtime.readQuota(JSON.stringify({ tokens: { access_token: "at" } }));
  assert.equal(quota.primary.usedPercent, 42);
  assert.equal(quota.secondary.usedPercent, 18);
  assert.equal(quota.planType, "pro");
  assert.equal(quota.ordinaryUsageAllowed, true);
});

test("login and quota processes receive current proxy settings and redact proxy credentials", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-proxy-runtime-test-"));
  const command = join(directory, "fake-codex");
  await writeFile(command, `#!/usr/bin/env node
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(m.id===undefined)return;
 const proxy=process.env.HTTPS_PROXY;
 const result=m.method==='account/login/start'?{userCode:proxy}:m.method==='account/rateLimits/read'?{rateLimits:{planType:proxy}}:{};
 if(proxy.includes('secret')) process.stdout.write(JSON.stringify({id:m.id,error:{message:'Cannot reach '+proxy}})+'\\n');
 else process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
});`, { mode: 0o700 });
  let proxy = "http://first.test:8080";
  const runtime = new CodexRuntime({ command, getProxyEnvironment: () => ({ HTTPS_PROXY: proxy }), timeoutMs: 5000 });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  const handle = await runtime.beginLogin();
  assert.equal(handle.publicState().userCode, proxy);
  await handle.close();
  proxy = "http://second.test:7890";
  assert.equal((await runtime.readQuota({})).planType, proxy);
  proxy = "";
  assert.equal((await runtime.readQuota({})).planType, null);
  proxy = "http://alice:secret@proxy.test:8080";
  await assert.rejects(runtime.beginLogin(), (error) => !error.message.includes("secret") && !error.message.includes("alice") && error.message.includes("REDACTED"));
});

test("runtime explicitly refreshes and returns updated credentials even if quota lookup fails", async t=>{
  const directory=await mkdtemp(join(tmpdir(),"codex-refresh-runtime-"));const command=join(directory,'fake-codex');
  await writeFile(command,`#!/usr/bin/env node
const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 if(m.method==='account/read' && m.params.refreshToken){fs.writeFileSync(process.env.CODEX_HOME+'/auth.json',JSON.stringify({tokens:{access_token:'new-at',refresh_token:'new-rt'}}));}
 const error=m.method==='account/rateLimits/read'?{message:'quota network failure'}:null;
 process.stdout.write(JSON.stringify(error?{id:m.id,error}:{id:m.id,result:{account:{type:'chatgpt'}}})+'\\n');
});`,{mode:0o700});
  const runtime=new CodexRuntime({command});t.after(async()=>{await runtime.close();await rm(directory,{recursive:true,force:true});});
  const result=await runtime.inspect({tokens:{access_token:'old-at',refresh_token:'old-rt'}},{refresh:true});
  assert.equal(result.refreshed,true);assert.equal(result.error.message,'quota network failure');assert.equal(JSON.parse(result.updatedAuthJson).tokens.refresh_token,'new-rt');
});
