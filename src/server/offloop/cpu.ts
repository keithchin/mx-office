// Every core's busy and idle time, read off the event loop. os.cpus() is a synchronous call that on
// Windows also reads each core's name and speed from the registry: on a loaded machine (builds, the
// virus scanner) it held the office's event loop 100–1100 ms every 5 s (the machine monitor's sample,
// the busy office check, 2026-10-08). Here it runs in a small worker thread of its own (made on first
// use, let go when idle), so the main thread only posts a message. If the thread can't be made, it's
// read here as before, so the monitor never stops working.

import os from 'node:os';
import { Worker } from 'node:worker_threads';

export interface CpuTimes {
  idle: number;
  total: number;
}

/** The sums, from os.cpus(): what a reading is. */
export function sumCpus(cpus: Pick<os.CpuInfo, 'times'>[]): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle;
  }
  return { idle, total };
}

// Plain CommonJS so it runs the same under tsx (tests) and from dist.
const WORKER = `
const { parentPort } = require('node:worker_threads');
const os = require('node:os');
parentPort.on('message', (id) => {
  let idle = 0, total = 0;
  try {
    for (const c of os.cpus()) {
      idle += c.times.idle;
      total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle;
    }
  } catch {}
  parentPort.postMessage({ id, idle, total });
});
`;

let worker: Worker | undefined;
let broken = false;
let nextId = 1;
const pending = new Map<number, (t: CpuTimes) => void>();

function theWorker(): Worker | undefined {
  if (worker || broken) return worker;
  try {
    const w = new Worker(WORKER, { eval: true, stdout: false, stderr: false });
    w.on('message', (m: { id: number } & CpuTimes) => {
      const take = pending.get(m.id);
      pending.delete(m.id);
      if (!pending.size) w.unref();
      take?.({ idle: m.idle, total: m.total });
    });
    const lost = () => {
      if (worker === w) worker = undefined;
      for (const [id, take] of [...pending]) {
        pending.delete(id);
        take(sumCpus(os.cpus()));
      }
    };
    w.on('error', () => {
      broken = true;
      lost();
    });
    w.on('exit', lost);
    w.unref();
    worker = w;
  } catch {
    broken = true;
  }
  return worker;
}

/** Every core's times so far, read in the worker thread (here if there's none). */
export function cpuTimesOff(): Promise<CpuTimes> {
  const w = theWorker();
  if (!w) return Promise.resolve(sumCpus(os.cpus()));
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    w.ref();
    w.postMessage(id);
  });
}

/** Lets the thread go (tests, shutdown); the next reading makes a new one. */
export function stopCpuWorker(): Promise<void> {
  const w = worker;
  worker = undefined;
  return w ? w.terminate().then(() => undefined) : Promise.resolve();
}
