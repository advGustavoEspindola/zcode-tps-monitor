#!/usr/bin/env node
// Hook Stop: disparado pelo cliente quando o fluxo de resposta termina/é interrompido (a partir de 2026-10
// confirmou-se na prática que ele dispara, e em horário impreciso — já foi observado disparando durante o
// turno do usuário, e não apenas ao final dele).
// Responsabilidades:
// 1) Mantém o sessionId do arquivo de estado em sincronia, mas **nunca sobrescreve o promptTs** — esse é o
//    fundamento da guarda --current da "estatística desta pergunta" (na 0.8.4 e antes, cada disparo regravava
//    o momento da pergunta com o momento atual, fazendo a guarda julgar erroneamente "sem dados para esta
//    pergunta" e a linha de estatística sumir).
// 2) Exibição direta opcional (experimental): com {"stopHookLine": true}, mostra a estatística do turno via
//    systemMessage, no máximo uma vez por turno. Desligado por padrão — como o horário do disparo é impreciso,
//    evita-se exibição precoce/repetida.
// Saída em JSON estrito; qualquer exceção encerra em silêncio, sem afetar a conversa.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { queryTurn, formatTurnLine } from "../scripts/token-rate.mjs";

const STATE_FILE =
  process.env.TPS_MONITOR_STATE_FILE ||
  path.join(os.homedir(), ".zcode", "tps-monitor.last-session.json");

// stdin é o JSON de entrada do hook (contém session_id); há um tempo limite de segurança para que não fique pendurado caso o cliente não forneça stdin
function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve(raw);
      }
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", finish);
    setTimeout(finish, 1500);
  });
}

function readConfig() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".zcode", "tps-monitor.config.json"), "utf8")
    );
  } catch {
    return {};
  }
}

function readStateFile() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) || {};
  } catch {
    return {};
  }
}

// Grava o arquivo de estado: sessionId/ts acompanham este disparo; o promptTs só é preservado quando já existe um valor confiável para a mesma sessão
// (a origem deve ser prompt-submit/session-start; se ausente, usa o momento atual como segurança, e a próxima mensagem se autorrecupera)
function writeState(fields) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(fields));
  } catch {}
}

function noteSession(sid) {
  if (!sid) return;
  const prev = readStateFile();
  const same = prev.sessionId === sid;
  let promptTs = Date.now();
  if (same && Number.isFinite(prev.promptTs)) promptTs = prev.promptTs;
  else if (same && Number.isFinite(prev.ts) && prev.source === "prompt-submit") promptTs = prev.ts;
  writeState({
    ...prev,
    sessionId: sid,
    ts: Date.now(),
    promptTs,
    source: "stop",
  });
}

async function main() {
  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || "{}");
  } catch {}
  const sid =
    payload.session_id ||
    process.env.ZCODE_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    "";
  noteSession(sid);

  const cfg = readConfig();
  if (cfg.tokenRateLine === false || cfg.stopHookLine !== true) return;

  // Exibição direta (experimental): como o horário do disparo é impreciso, aguarda os dados ficarem prontos e depois deduplica por turnId, no máximo uma vez por turno
  let r = null;
  for (let i = 0; i < 5; i++) {
    r = queryTurn(sid || null);
    if (r && r.turn && r.turn.rated > 0) break;
    if (i < 4) await new Promise((res) => setTimeout(res, 250));
  }
  if (!r || !r.turn) return; // sem dados do turno (ex.: turno interrompido), não incomoda
  const prev = readStateFile();
  if (prev.lastShown && prev.lastShown.turnId === r.turnId) return; // já exibido neste turno
  writeState({ ...prev, lastShown: { turnId: r.turnId, at: Date.now() } });
  process.stdout.write(JSON.stringify({ systemMessage: formatTurnLine(r) }));
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
