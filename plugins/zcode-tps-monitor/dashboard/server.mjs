#!/usr/bin/env node
// Serviço do painel de monitoramento em tempo real de TPS: sem dependências, Node >= 18.
//   node dashboard/server.mjs [--port 7423]
// A página faz polling de /api/metrics a cada segundo; a fonte de dados é a mesma do script de
// coleta (variável de ambiente TPS_URL; quando não definida, dados de demonstração).

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { snapshot } from "../scripts/lib/collect-core.mjs";
import { query as tokenRateQuery, queryTurn as tokenRateTurnQuery } from "../scripts/token-rate.mjs";

// Arquivo de estado: os hooks (SessionStart/UserPromptSubmit) registram "a última sessão em que o usuário esteve"
const STATE_FILE = path.join(os.homedir(), ".zcode", "tps-monitor.last-session.json");

function followedSessionId() {
  try {
    const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (st && st.sessionId && Date.now() - (st.ts || 0) < 7 * 24 * 3600 * 1000) {
      return { id: st.sessionId, source: st.source || "hook" };
    }
  } catch {}
  return { id: null, source: "auto" };
}

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const PORT = portIdx !== -1 ? Number(args[portIdx + 1]) || 7423 : 7423;
const HOST = "127.0.0.1";
// Saída automática por ociosidade: sai sozinho após N minutos sem requisições HTTP, evitando deixar
// processos em segundo plano depois de fechar a sessão (0 = não sai sozinho)
const idleIdx = args.indexOf("--idle-exit");
const IDLE_EXIT_MIN = idleIdx !== -1 ? Number(args[idleIdx + 1]) : 180;
const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = fs.readFileSync(path.join(here, "index.html"), "utf8");

// Arquivo de PID: permite que /tps-doctor detecte o estado de execução e ofereça um modo de parar
const PID_FILE = path.join(os.homedir(), ".zcode", "tps-monitor.dashboard.pid");
function writePid() {
  try {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid));
  } catch {}
}
function cleanup() {
  try {
    if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, "utf8").trim() === String(process.pid)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {}
}
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("exit", cleanup);

let lastRequestAt = Date.now();
const server = http.createServer(async (req, res) => {
  lastRequestAt = Date.now();
  if (req.url === "/" || req.url.startsWith("/index")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(indexHtml);
    return;
  }
  if (req.url.startsWith("/api/metrics")) {
    try {
      const s = await snapshot();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(s));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  if (req.url.startsWith("/api/token-rate")) {
    try {
      const followed = followedSessionId();
      const r = tokenRateQuery(followed.id);
      r.follow = followed;
      // Última pergunta (pode ainda estar em geração): o banco de uso grava por turn em tempo real,
      // segmento a segmento; com polling a cada segundo já se vê a taxa do turno atual
      try {
        r.turn = tokenRateTurnQuery(followed.id).turn;
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(r));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("não encontrado");
});

server.listen(PORT, HOST, () => {
  const src = process.env.TPS_URL && !process.env.TPS_URL.startsWith("${")
    ? `remoto: ${process.env.TPS_URL}`
    : "demo (dados de demonstração internos)";
  console.log(`[zcode-tps-monitor] painel iniciado: http://${HOST}:${PORT}   fonte de dados: ${src}`);
  if (IDLE_EXIT_MIN > 0) {
    console.log(`[zcode-tps-monitor] ${IDLE_EXIT_MIN} min sem acesso → sai sozinho (--idle-exit 0 desativa esse comportamento)`);
  }
  writePid();
});

// Verificação periódica da saída por ociosidade: usa metade do limite de ociosidade como intervalo
// de checagem (limitado entre 1s e 60s)
if (IDLE_EXIT_MIN > 0) {
  const tick = Math.min(60000, Math.max(1000, (IDLE_EXIT_MIN * 60 * 1000) / 2));
  const timer = setInterval(() => {
    if (Date.now() - lastRequestAt > IDLE_EXIT_MIN * 60 * 1000) {
      console.log("[zcode-tps-monitor] sem acesso por muito tempo; o painel sai sozinho");
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    }
  }, tick);
  timer.unref();
}
