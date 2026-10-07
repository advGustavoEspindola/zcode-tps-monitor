// Núcleo de coleta: compartilhado entre a CLI (scripts/collect.mjs) e o servidor MCP (mcp/tps-server.mjs).
// Zero dependências de terceiros, requer Node >= 18 (fetch global).

import os from "node:os";

// ---------- Utilidades ----------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

export function resolveUrl(env = process.env) {
  // Um placeholder de user_config não configurado, quando passado literalmente, é tratado como não configurado
  const url = (env.TPS_URL || "").trim();
  if (!url || url.startsWith("${")) return null;
  return url;
}

// ---------- Dados de demonstração (caminhada aleatória, valores contínuos e realistas) ----------

const demo = { tps: 820, p50: 12.4, err: 0.12 };

function demoStep() {
  demo.tps = clamp(demo.tps + (Math.random() * 120 - 60), 240, 1560);
  demo.p50 = clamp(demo.p50 + (Math.random() * 2 - 1), 6, 40);
  demo.err = clamp(demo.err + (Math.random() * 0.08 - 0.04), 0.01, 2.5);
  return {
    tps: Math.round(demo.tps),
    p50: r1(demo.p50),
    p95: r1(demo.p50 * 2.6),
    p99: r1(demo.p50 * 4.1),
    errorRate: r2(demo.err),
  };
}

// ---------- Interface remota (correspondência flexível de nomes de campo, suporta um nível de aninhamento) ----------

const TPS_KEYS = ["tps", "qps", "throughput", "transactionsPerSecond"];
const LAT_KEYS = { p50: ["p50", "latency_p50"], p95: ["p95", "latency_p95"], p99: ["p99", "latency_p99"] };
const ERR_KEYS = ["error_rate", "errorRate", "err_rate"];

function deepFind(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 3) return undefined;
  for (const k of keys) {
    if (typeof obj[k] === "number" && isFinite(obj[k])) return obj[k];
  }
  for (const v of Object.values(obj)) {
    const hit = deepFind(v, keys, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export async function fetchRemoteMetrics(url, timeoutMs = 5000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { signal: ac.signal, headers: { Accept: "application/json" } });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const tps = deepFind(data, TPS_KEYS);
  if (tps === undefined) throw new Error("Campo tps/qps não encontrado na resposta");
  return {
    tps: Math.round(tps),
    p50: deepFind(data, LAT_KEYS.p50) ?? null,
    p95: deepFind(data, LAT_KEYS.p95) ?? null,
    p99: deepFind(data, LAT_KEYS.p99) ?? null,
    errorRate: deepFind(data, ERR_KEYS) ?? null,
  };
}

// ---------- Recursos locais do sistema (no Windows loadavg é sempre 0; usa amostragem por diferença de tempo de CPU) ----------

function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.idle + c.times.user + c.times.nice + c.times.sys + c.times.irq;
  }
  return { idle, total };
}

export async function sampleCpuPercent(intervalMs = 250) {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, intervalMs));
  const b = cpuTimes();
  const dIdle = b.idle - a.idle, dTotal = b.total - a.total;
  if (dTotal <= 0) return null;
  return r1(clamp((1 - dIdle / dTotal) * 100, 0, 100));
}

async function systemMetrics() {
  const cpus = os.cpus().length;
  const cpuPercent = await sampleCpuPercent();
  const totalMB = os.totalmem() / 1048576;
  const freeMB = os.freemem() / 1048576;
  return {
    cpuPercent,
    cpuCores: cpus,
    memTotalMB: Math.round(totalMB),
    memUsedMB: Math.round(totalMB - freeMB),
    memPercent: r1(((totalMB - freeMB) / totalMB) * 100),
    hostUptimeHours: r1(os.uptime() / 3600),
    platform: `${os.platform()}/${os.arch()}`,
  };
}

// ---------- Instantâneo e amostragem ----------

export async function snapshot(env = process.env) {
  const url = resolveUrl(env);
  let m, mode;
  if (url) {
    try {
      m = await fetchRemoteMetrics(url);
      mode = "remote";
    } catch (err) {
      m = demoStep();
      mode = `demo(Interface indisponível: ${err.message}, usando dados de demonstração)`;
    }
  } else {
    m = demoStep();
    mode = "demo";
  }
  return { time: new Date().toISOString(), mode, ...m, system: await systemMetrics() };
}

export async function watch(seconds, env = process.env) {
  const n = clamp(Math.round(seconds || 5), 2, 60);
  const url = resolveUrl(env);
  const samples = [];
  let mode = url ? "remote" : "demo";
  let fallbackNote = null;
  for (let i = 0; i < n; i++) {
    if (url && mode === "remote") {
      try {
        const m = await fetchRemoteMetrics(url, 3000);
        samples.push(m);
      } catch (err) {
        mode = "demo";
        fallbackNote = `Interface indisponível (${err.message}), usando dados de demonstração`;
        samples.push(demoStep());
      }
    } else {
      samples.push(demoStep());
    }
    if (i < n - 1) await new Promise((r) => setTimeout(r, 1000));
  }
  const tpsArr = samples.map((s) => s.tps).sort((a, b) => a - b);
  const stat = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
  const avg = (f) => r1(samples.reduce((s, x) => s + (x[f] ?? 0), 0) / samples.filter((x) => x[f] != null).length);
  return {
    time: new Date().toISOString(),
    mode: fallbackNote ? `demo(${fallbackNote})` : mode,
    seconds: n,
    count: samples.length,
    tps: { avg: Math.round(avg("tps")), min: tpsArr[0], max: tpsArr[tpsArr.length - 1] },
    p95avg: avg("p95"),
    p99avg: avg("p99"),
    errorRateAvg: r2(avg("errorRate")),
    samples,
  };
}

// ---------- Saída legível por humanos ----------

const GB = (mb) => (mb / 1024).toFixed(1);

export function formatSnapshot(s) {
  const t = s.time.replace("T", " ").slice(0, 19);
  const lines = [
    `⏱ Instantâneo do monitor TPS  ${t}   [modo: ${s.mode}]`,
    `  TPS(atual)         : ${s.tps}`,
    `  Latência p50/p95/p99 : ${s.p50 ?? "-"} / ${s.p95 ?? "-"} / ${s.p99 ?? "-"} ms`,
    `  Taxa de erro       : ${s.errorRate ?? "-"} %`,
    `  —— Recursos do sistema ——`,
    `  CPU                : ${s.system.cpuPercent ?? "-"} %  (${s.system.cpuCores} núcleos)`,
    `  Memória            : ${GB(s.system.memUsedMB)} / ${GB(s.system.memTotalMB)} GB (${s.system.memPercent} %)`,
    `  Tempo de atividade : ${s.system.hostUptimeHours} horas  (${s.system.platform})`,
  ];
  return lines.join("\n");
}

export function formatWatch(w) {
  const t = w.time.replace("T", " ").slice(0, 19);
  const head = `⏱ Relatório de amostragem TPS  ${t}   [modo: ${w.mode}]  ${w.count} amostras × 1s`;
  const rows = w.samples.map((s, i) => `  #${String(i + 1).padStart(2, "0")}  tps=${String(s.tps).padEnd(6)} p95=${String(s.p95 ?? "-").padEnd(6)} err=${s.errorRate ?? "-"}%`);
  const stat = [
    `  —— Estatísticas ——`,
    `  TPS médio/mín/máx  : ${w.tps.avg} / ${w.tps.min} / ${w.tps.max}`,
    `  média de p95       : ${w.p95avg} ms`,
    `  média de p99       : ${w.p99avg} ms`,
    `  média da taxa de erro : ${w.errorRateAvg} %`,
  ];
  return [head, ...rows, ...stat].join("\n");
}
