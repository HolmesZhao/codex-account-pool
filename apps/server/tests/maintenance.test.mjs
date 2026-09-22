import test from "node:test";
import assert from "node:assert/strict";
import { MaintenanceScheduler } from "../src/domain/maintenance-scheduler.mjs";

test("maintenance respects configured concurrency", async () => {
  let active = 0;
  let maximum = 0;
  const scheduler = new MaintenanceScheduler({
    listAccountIds: async () => ["a", "b", "c", "d"],
    maintain: async () => { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; },
    concurrency: 2,
  });
  await scheduler.runOnce();
  assert.equal(maximum, 2);
});

test("stop during an active scan does not restart the scheduler or schedule more accounts", async () => {
  let callback, release; const calls=[]; let scheduled=0;
  const scheduler=new MaintenanceScheduler({listAccountIds:async()=>['a','b'],maintain:async id=>{calls.push(id);if(id==='a'){await new Promise(resolve=>{release=resolve;});throw new Error('failure');}},concurrency:1,timers:{setTimeout(fn){callback=fn;scheduled++;return 1;},clearTimeout(){}}});
  scheduler.start();const tick=callback();
  while(!release) await new Promise(resolve=>setImmediate(resolve));
  const stopped=scheduler.stop();release();await tick;await stopped;
  assert.equal(scheduled,1);assert.deepEqual(calls,['a']);
});


test("an account failure does not abort the remaining scan",async()=>{
 const calls=[]; const scheduler=new MaintenanceScheduler({listAccountIds:async()=>['a','b'],concurrency:1,maintain:async id=>{calls.push(id);if(id==='a')throw new Error('failure');}});
 await scheduler.runOnce();assert.deepEqual(calls,['a','b']);
});
