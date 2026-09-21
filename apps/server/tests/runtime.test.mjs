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
