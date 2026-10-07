#!/usr/bin/env node
// Autodiagnóstico: verifica cada etapa da qual o plugin depende para funcionar e localiza problemas
// do tipo "a linha de taxa sumiu".
// Uso:
//   node scripts/doctor.mjs           legível por humanos
//   node scripts/doctor.mjs --json    JSON (para consumo por programa)
// Código de saída: 1 se houver itens ❌, caso contrário 0.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.removeAllListeners("warning");
process.on("warning", () => {});

const HOME = os.homedir();
const DB_PATH =
  process.env.ZCODE_USAGE_DB || path.join(HOME, ".zcode", "cli", "db", "db.sqlite");
const STATE_FILE =
  process.env.TPS_MONITOR_STATE_FILE || path.join(HOME, ".zcode", "tps-monitor.last-session.json");
const CONFIG_FILE = path.join(HOME, ".zcode", "tps-monitor.config.json");
const PID_FILE = path.join(HOME, ".zcode", "tps-monitor.dashboard.pid");

// Colunas das quais a consulta do hook depende (tabela model_usage)
const REQUIRED_COLS = [
  "session_id", "status", "query_source", "model_id",
  "output_tokens", "reasoning_tokens", "input_tokens", "cache_read_input_tokens",
  "first_token_at", "completed_at", "time_to_first_token_ms",
];

function nodeVersionCheck() {
  const [maj, min] = process.versions.node.split(".").map(Number);
  const ok = maj > 22 || (maj === 22 && min >= 5);
  return {
    name: "Versão do Node",
    ok,
    detail: `Atual ${process.versions.node}, requer ≥ 22.5 (node:sqlite embutido)`,
    hint: ok ? null : "Atualize o Node e tente novamente: nvm install 22 / instale o LTS mais recente no site oficial",
  };
}

async function dbCheck() {
  if (!fs.existsSync(DB_PATH)) {
    return {
      name: "Banco de dados de uso",
      ok: false,
      detail: `Não encontrado ${DB_PATH}`,
      hint: "Se os dados do ZCode não estiverem no local padrão, defina a variável de ambiente ZCODE_USAGE_DB apontando para db.sqlite",
    };
  }
  let db;
  try {
    // Carregamento dinâmico, para evitar que um Node sem node:sqlite quebre já na fase de import
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(DB_PATH, { readOnly: true });
  } catch (e) {
    return {
      name: "Banco de dados de uso",
      ok: false,
      detail: `Não foi possível abrir ${DB_PATH} somente para leitura: ${e.message}`,
      hint: "Confirme que o arquivo está em formato SQLite e não está travado em uso exclusivo",
    };
  }
  try {
    const cols = db.prepare("PRAGMA table_info(model_usage)").all().map((c) => c.name);
    if (!cols.length) {
      return { name: "Banco de dados de uso", ok: false, detail: "A tabela model_usage não existe", hint: "A versão do ZCode é muito antiga ou ainda não gerou dados de uso; envie uma mensagem e tente novamente" };
    }
    const missing = REQUIRED_COLS.filter((c) => !cols.includes(c));
    if (missing.length) {
      return {
        name: "Banco de dados de uso", ok: false,
        detail: `Faltam colunas em model_usage: ${missing.join(", ")}`,
        hint: "A versão do ZCode mudou a estrutura da tabela; atualize o plugin ou relate um issue",
      };
    }
    const last = db
      .prepare("SELECT completed_at FROM model_usage WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1")
      .get();
    const ageMin = last ? Math.round((Date.now() - last.completed_at) / 60000) : null;
    return {
      name: "Banco de dados de uso",
      ok: true,
      detail: `Estrutura da tabela completa; amostra concluída mais recente: ${ageMin == null ? "nenhuma" : ageMin + " minutos atrás"}`,
      hint: null,
    };
  } finally {
    db.close();
  }
}

function stateFileCheck() {
  try {
    const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const age = Math.round((Date.now() - (st.ts || 0)) / 60000);
    // ts é a base da guarda --current da "estatística desta pergunta": sem ela, a guarda degrada para
    // permitir, podendo exibir dados antigos
    const hasTs = Number.isFinite(st.ts);
    return {
      name: "Arquivo de estado da sessão",
      ok: hasTs,
      detail:
        `Existe, sessionId=${String(st.sessionId).slice(0, 8)}…, atualizado há ${age} minutos` +
        (hasTs ? "" : ", mas sem o timestamp da pergunta"),
      hint: hasTs ? null : "O arquivo de estado foi escrito por um hook de versão antiga; reenvie uma mensagem para que o novo hook o reescreva e corrija",
    };
  } catch {
    return {
      name: "Arquivo de estado da sessão",
      ok: false,
      detail: "Não existe ou não pode ser lido",
      hint: "O hook nunca rodou: confirme que o plugin está instalado e que a sessão foi reaberta (hooks são registrados apenas em novas sessões após instalação/atualização)",
    };
  }
}

function configCheck() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    const off = cfg.tokenRateLine === false;
    const direct = cfg.stopHookLine === true;
    return {
      name: "Arquivo de configuração",
      ok: true,
      detail:
        off
          ? "tokenRateLine=false, injeção da linha de taxa desativada (comportamento esperado)"
          : "Lido, injeção ativada" + (direct ? "; stopHookLine=true, exibição direta do Stop (experimental) ativada" : ""),
      hint: off ? "Para reativar a injeção, exclua o arquivo ou volte para true" : null,
    };
  } catch {
    return { name: "Arquivo de configuração", ok: true, detail: "Não configurado (injeção ativada por padrão)", hint: null };
  }
}

function dashboardCheck() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
    process.kill(pid, 0); // testa se o processo está vivo
    const stopCmd = process.platform === "win32" ? `taskkill /PID ${pid} /F` : `kill ${pid}`;
    return {
      name: "Processo do painel",
      ok: true,
      detail: `Em execução (PID ${pid})`,
      hint: `Para parar: ${stopCmd}`,
    };
  } catch {
    return { name: "Processo do painel", ok: true, detail: "Não está em execução", hint: null };
  }
}

export async function runDoctor() {
  const results = [];
  results.push(nodeVersionCheck());
  results.push(await dbCheck());
  results.push(stateFileCheck());
  results.push(configCheck());
  results.push(dashboardCheck());
  return { checks: results, failed: results.filter((r) => !r.ok).length };
}

// --- CLI ---
if (process.argv[1] && process.argv[1].endsWith("doctor.mjs")) {
  const report = await runDoctor();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const c of report.checks) {
      console.log(`${c.ok ? "✅" : "❌"} ${c.name}:${c.detail}`);
      if (c.hint) console.log(`   ↳ ${c.hint}`);
    }
    console.log(report.failed ? `\n${report.failed} item(ns) não passou(ram)` : "\nTodos os itens passaram");
  }
  process.exitCode = report.failed ? 1 : 0;
}
