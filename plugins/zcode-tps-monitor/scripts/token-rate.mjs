#!/usr/bin/env node
// Taxa de saída de tokens: calcula a verdadeira taxa de geração do modelo a partir do próprio banco
// de dados de uso do ZCode (tabela model_usage).
// Uso:
//   node token-rate.mjs            última requisição + estatísticas da sessão (legível por humanos)
//   node token-rate.mjs --turn     taxa instantânea da última pergunta (turno disparado por esta pergunta)
//   node token-rate.mjs --turn --current
//                                  idem, mas com saída vazia quando esta pergunta ainda não tem dados no
//                                  banco (guarda --current: nunca retorna dados do turno anterior como
//                                  se fossem desta pergunta)
//   node token-rate.mjs --json     saída em JSON
//   ZCODE_SESSION_ID=xxx node ...  considera apenas a sessão especificada
//   ZCODE_USAGE_DB=/path/db.sqlite define o caminho do banco (por padrão resolvido no diretório do usuário)
//   TPS_MONITOR_STATE_FILE=/path   define o arquivo de estado do hook (padrão ~/.zcode/tps-monitor.last-session.json)
// Abre o banco WAL somente para leitura, sem afetar o cliente em execução.

// Suprime o ruído do ExperimentalWarning do node:sqlite: é preciso assumir o canal de warnings antes
// do import dinâmico (módulos nativos com import estático são avaliados antes da execução do corpo do
// módulo; ouvir depois já seria tarde demais).
process.removeAllListeners("warning");
process.on("warning", () => {});

const { DatabaseSync } = await import("node:sqlite");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Caminho padrão multiplataforma (macOS/Linux: ~/.zcode/...; Windows: %USERPROFILE%\.zcode\...), pode ser sobrescrito por ZCODE_USAGE_DB
const DB_PATH =
  process.env.ZCODE_USAGE_DB ||
  path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite");
const N = Number(process.env.TOKEN_RATE_WINDOW) || 5;           // janela estatística (média/pico)
const HIST = Number(process.env.TOKEN_RATE_HIST) || 60;         // pontos de histórico do gráfico
const MIN_GEN_MS = Number(process.env.TOKEN_RATE_MIN_MS) || 200;      // amostra válida: tempo mínimo de geração
const MAX_GEN_MS = Number(process.env.TOKEN_RATE_MAX_MS) || 3_600_000; // amostra válida: tempo máximo de geração (1h)

// Arquivo de estado do hook: registra a "sessão em que o usuário esteve por último" e o momento da pergunta
// mais recente (a guarda --current depende de ts)
const STATE_FILE =
  process.env.TPS_MONITOR_STATE_FILE ||
  path.join(os.homedir(), ".zcode", "tps-monitor.last-session.json");
const STATE_TTL_MS = 7 * 24 * 3600 * 1000; // arquivos de estado velhos demais são considerados inválidos (mesma lógica de seguimento do painel)

function readState() {
  try {
    const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!st || !Number.isFinite(st.ts) || Date.now() - st.ts > STATE_TTL_MS) return null;
    return st;
  } catch {
    return null;
  }
}

function openDb() {
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

// Ordem de resolução quando a sessão não é informada explicitamente: a "sessão em que o usuário esteve
// por último" no arquivo de estado (acompanha a troca de sessão) → a sessão da requisição concluída mais
// recente em todo o banco
function fallbackSessionId(db) {
  const st = readState();
  if (st && st.sessionId) return st.sessionId;
  const row = db
    .prepare("SELECT session_id FROM model_usage WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1")
    .get();
  return row ? row.session_id : null;
}

function resolveSession(db, sessionId) {
  const sid = sessionId || fallbackSessionId(db);
  return { sid, scoped: sessionId ? "explicit" : "auto" };
}

// Escopo de filtragem com prioridade para a conversa principal: quando há dados de main_turn, conta
// apenas main_turn; caso contrário, volta para todas as requisições
function scopeFor(db, sid) {
  // turn_id só é projetado quando a coluna existe: bancos de clientes antigos não a têm e uma referência
  // no SELECT quebraria a consulta inteira; o COUNT(DISTINCT turn_id) do acumulado da sessão depende
  // dessa projeção
  let turnCol = "";
  try {
    const cols = db.prepare("PRAGMA table_info(model_usage)").all();
    if (cols.some((c) => c.name === "turn_id")) turnCol = ", turn_id";
  } catch {}
  const base =
    "SELECT model_id, output_tokens, reasoning_tokens, input_tokens, cache_read_input_tokens," +
    " first_token_at, completed_at, time_to_first_token_ms, status" + turnCol +
    " FROM model_usage WHERE status = 'completed' AND query_source = 'main_turn'";
  const args = sid ? [sid] : [];
  const hasMain = db
    .prepare(base + (sid ? " AND session_id = ?" : "") + " LIMIT 1")
    .get(...args);
  const scopeSql = hasMain
    ? base + " AND session_id = ?"
    : base.replace(" AND query_source = 'main_turn'", "") + (sid ? " AND session_id = ?" : "");
  return { scopeSql, args };
}

function toItem(r) {
  const tok = r.output_tokens ?? 0;
  const reasoning = r.reasoning_tokens ?? 0;
  // Algumas linhas (como requisições não-streaming ou interrompidas) não têm first_token_at e devem ser consideradas inválidas
  const hasTime = Number.isFinite(r.first_token_at) && Number.isFinite(r.completed_at) && r.completed_at > r.first_token_at;
  const genMs = hasTime ? r.completed_at - r.first_token_at : null; // tempo de geração puro (sem a espera pelo primeiro token)
  // O numerador da taxa inclui os tokens de raciocínio: o conteúdo de raciocínio também é gerado em streaming; quando o ZCode não o registra em coluna separada, esse campo fica 0 e o comportamento não muda
  const rateTokens = tok + reasoning;
  const valid = genMs != null && genMs >= MIN_GEN_MS && genMs < MAX_GEN_MS && rateTokens > 0;
  return {
    model: r.model_id,
    outputTokens: tok,
    reasoningTokens: reasoning,
    inputTokens: r.input_tokens ?? 0,
    cacheRead: r.cache_read_input_tokens ?? 0,
    ttftMs: Number.isFinite(r.time_to_first_token_ms) ? r.time_to_first_token_ms : null,
    genMs,
    tokPerSec: valid ? Math.round((rateTokens / genMs) * 10000) / 10 : null,
    completedAt: r.completed_at,
  };
}

// O acumulado da sessão usa um SUM independente (não limitado pela janela de exibição); a média/pico da taxa é passada pelo chamador de acordo com a janela
function sessionAggregate(db, scopeSql, args, rated) {
  if (!rated.length) return null;
  const sumRow = db
    .prepare(
      "SELECT COUNT(*) n, SUM(output_tokens) o, SUM(reasoning_tokens) r," +
      " SUM(input_tokens) i, SUM(cache_read_input_tokens) c," +
      " AVG(time_to_first_token_ms) ttft," +
      " SUM(CASE WHEN first_token_at IS NOT NULL AND completed_at > first_token_at THEN completed_at - first_token_at ELSE 0 END) genMs" +
      " FROM (" + scopeSql + ")"
    )
    .get(...args);
  // Número de turnos da sessão: COUNT(DISTINCT turn_id); em bancos antigos sem a coluna turn_id, recua para o número de requisições
  let turns = sumRow.n ?? 0;
  try {
    const trow = db.prepare("SELECT COUNT(DISTINCT turn_id) t FROM (" + scopeSql + ")").get(...args);
    if (trow && trow.t != null) turns = trow.t;
  } catch {}
  const out = (sumRow.o ?? 0) + (sumRow.r ?? 0);
  const genMs = sumRow.genMs ?? 0;
  return {
    samples: rated.length,
    requests: sumRow.n ?? 0,
    turns,
    avg: Math.round((rated.reduce((s, i) => s + i.tokPerSec, 0) / rated.length) * 10) / 10,
    max: Math.max(...rated.map((i) => i.tokPerSec)),
    min: Math.min(...rated.map((i) => i.tokPerSec)),
    totalOutput: sumRow.o ?? 0,
    totalReasoning: sumRow.r ?? 0,
    totalInput: sumRow.i ?? 0,
    totalCacheRead: sumRow.c ?? 0,
    avgTtftMs: sumRow.ttft != null ? Math.round(sumRow.ttft) : null,
    totalGenMs: genMs,
    tokPerSec: genMs >= MIN_GEN_MS && out > 0 ? Math.round((out / genMs) * 10000) / 10 : null,
  };
}

function query(sessionId) {
  const db = openDb();
  try {
    const { sid, scoped } = resolveSession(db, sessionId);
    const { scopeSql, args } = scopeFor(db, sid);
    // O histórico do gráfico (janela grande) e as estatísticas (janela pequena) são consultados separadamente, para não perder dados ao atualizar/reabrir
    const histRows = db.prepare(scopeSql + " ORDER BY completed_at DESC LIMIT ?").all(...args, HIST);
    const items = histRows.slice(0, N).map(toItem);
    const rated = items.filter((i) => i.tokPerSec != null);
    // Para exibição, o latest prioriza o registro "válido" mais recente, evitando que linhas em andamento/sem campos desbancem o destaque
    const latest = rated[0] ?? items[0] ?? null;
    const session = sessionAggregate(db, scopeSql, args, rated);
    return { sessionId: sid, scoped, latest, session, history: items.slice().reverse() };
  } finally {
    db.close();
  }
}

// Este turno = o turn_id mais recente da sessão (todas as requisições disparadas por uma mensagem do
// usuário compartilham o mesmo turn_id, incluindo cada trecho "modelo→ferramenta→modelo"). Ao final da
// resposta (quando o modelo roda --turn --current), todos os trechos concluídos deste turno já foram
// gravados em tempo real, permitindo uma verdadeira "taxa instantânea desta pergunta"; no momento do
// prompt-submit esta pergunta ainda não ocorreu, então só é possível ver o turno anterior.
function latestTurnId(db, sid) {
  try {
    const row = db
      .prepare("SELECT turn_id FROM model_usage WHERE session_id = ? AND turn_id IS NOT NULL ORDER BY completed_at DESC LIMIT 1")
      .get(sid);
    return row ? row.turn_id : null;
  } catch {
    return null; // bancos de clientes antigos não têm a coluna turn_id
  }
}

// Timestamp da última pergunta do usuário (os hooks prompt-submit/session-start gravam promptTs; o hook
// Stop atualiza ts, mas preserva promptTs); usado pela guarda --current: se todas as linhas do turno mais
// recente forem anteriores ao momento da pergunta, significa que esta pergunta ainda não gerou nenhuma
// requisição de modelo (turno só de perguntas e respostas) e não deve ser contabilizada como "esta pergunta".
function lastPromptTs() {
  const st = readState();
  const ts = st ? (Number.isFinite(st.promptTs) ? st.promptTs : st.ts) : null;
  return Number.isFinite(ts) ? ts : null;
}

function queryTurn(sessionId, opts = {}) {
  const db = openDb();
  try {
    const sid = sessionId || fallbackSessionId(db);
    if (!sid) return { sessionId: null, turnId: null, turn: null, session: null };
    const { scopeSql, args } = scopeFor(db, sid);
    const winRows = db.prepare(scopeSql + " ORDER BY completed_at DESC LIMIT ?").all(...args, N);
    const session = sessionAggregate(db, scopeSql, args, winRows.map(toItem).filter((i) => i.tokPerSec != null));
    const turnId = latestTurnId(db, sid);
    if (!turnId) return { sessionId: sid, turnId: null, turn: null, session };
    let turnRows;
    try {
      turnRows = db.prepare(scopeSql + " AND turn_id = ? ORDER BY completed_at ASC").all(...args, turnId);
    } catch {
      return { sessionId: sid, turnId: null, turn: null, session };
    }
    if (!turnRows.length) return { sessionId: sid, turnId, turn: null, session };
    // Guarda --current: se todas as linhas do turno mais recente forem anteriores ao momento desta pergunta
    // → esta pergunta ainda não tem nenhuma requisição de modelo (cenário típico: turno só de perguntas antes
    // de a resposta terminar); nunca devolve os dados do turno anterior fingindo ser "esta pergunta".
    if (opts.current) {
      const ts = lastPromptTs();
      const lastAt = Math.max(...turnRows.map((r) => r.completed_at ?? 0));
      if (ts && lastAt < ts) {
        return { sessionId: sid, turnId, turn: null, noCurrentTurnData: true, session };
      }
    }
    const items = turnRows.map(toItem);
    const rated = items.filter((i) => i.tokPerSec != null);
    const totalTok = rated.reduce((s, i) => s + i.outputTokens + i.reasoningTokens, 0);
    const genMs = rated.reduce((s, i) => s + i.genMs, 0);
    const turn = {
      requests: items.length,
      rated: rated.length,
      ttftMs: items[0].ttftMs, // tempo até o primeiro token do primeiro trecho deste turno
      firstAt: items[0].completedAt,
      lastAt: items[items.length - 1].completedAt,
      genMs,
      totalOutput: items.reduce((s, i) => s + i.outputTokens, 0),
      totalReasoning: items.reduce((s, i) => s + i.reasoningTokens, 0),
      // Taxa instantânea deste turno: produção total / tempo total de geração puro (ponderado por trecho, excluindo a espera por ferramentas entre trechos); com um único trecho, é a taxa desse trecho
      tokPerSec: genMs >= MIN_GEN_MS && totalTok > 0 ? Math.round((totalTok / genMs) * 10000) / 10 : null,
      peak: rated.length ? Math.max(...rated.map((i) => i.tokPerSec)) : null,
    };
    return { sessionId: sid, turnId, turn, session };
  } finally {
    db.close();
  }
}

// Unidade compacta (para linhas injetadas e outros lugares de leitura rápida): abaixo de mil, cru; de mil a dez mil, um decimal com k; de dez mil a um milhão, k arredondado; acima de um milhão, um decimal com M
function fmtCompact(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return Math.round(n / 1000) + "k";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

// Números exatos com separador de milhar (saída por turno e detalhes da CLI): 2,762
function fmtNum(n) {
  return n.toLocaleString("en-US");
}

function formatLine(r) {
  const l = r.latest;
  if (!l) return "sem requisicoes concluidas";
  const t = new Date(l.completedAt).toLocaleTimeString("pt-BR", { hour12: false });
  const parts = [
    // A amostragem acontece no instante em que a mensagem é enviada; o destaque descreve a última resposta concluída
    `⚡ ${l.tokPerSec ?? "-"} tok/s (turno anterior)`,
    `TTFT ${l.ttftMs != null ? (l.ttftMs / 1000).toFixed(1) : "-"}s`,
    `saida ${fmtNum(l.outputTokens)}${l.reasoningTokens ? `(+${fmtNum(l.reasoningTokens)} raciocinio)` : ""} tok / geracao ${l.genMs != null ? (l.genMs / 1000).toFixed(1) : "-"}s`,
  ];
  if (r.session) {
    parts.push(`med. ${r.session.samples} ${r.session.avg} / pico ${r.session.max}`);
    parts.push(`acumulado ${fmtCompact(r.session.totalOutput + r.session.totalReasoning)} tok`);
  }
  parts.push(`⏱ ${t}`);
  return parts.join(" · ");
}

// Linha de estatística desta pergunta (autoteste ao final da resposta, hook Stop e painel de monitoramento)
function formatTurnLine(r) {
  const t = r.turn;
  if (!t) return "sem dados deste turno";
  const time = new Date(t.lastAt).toLocaleTimeString("pt-BR", { hour12: false });
  const parts = [
    // A amostragem acontece no instante logo após o fim da resposta; o destaque é a taxa instantânea deste turno
    `⚡ ${t.tokPerSec ?? "-"} tok/s (este turno)`,
    `TTFT ${t.ttftMs != null ? (t.ttftMs / 1000).toFixed(1) : "-"}s`,
    `saida ${fmtNum(t.totalOutput)}${t.totalReasoning ? `(+${fmtNum(t.totalReasoning)} raciocinio)` : ""} tok / geracao ${t.genMs > 0 ? (t.genMs / 1000).toFixed(1) : "-"}s`,
  ];
  if (t.requests > 1) parts.push(`${t.requests} etapas / pico ${t.peak ?? "-"}`);
  if (r.session) parts.push(`acumulado ${fmtCompact(r.session.totalOutput + r.session.totalReasoning)} tok`);
  parts.push(`⏱ ${time}`);
  return parts.join(" · ");
}

// --- CLI ---
if (process.argv[1] && process.argv[1].endsWith("token-rate.mjs")) {
  const json = process.argv.includes("--json");
  const turnOnly = process.argv.includes("--turn");
  const current = process.argv.includes("--current");
  const sid = process.env.ZCODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
  if (turnOnly) {
    const r = queryTurn(sid, { current });
    if (json) console.log(JSON.stringify(r, null, 2));
    else if (r.turn) console.log(formatTurnLine(r));
    // Com --current e ainda sem dados desta pergunta: não imprime nenhuma linha, e o chamador não exibe estatística (nunca recorre ao turno anterior)
  } else {
    const r = query(sid);
    if (json) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      const s = r.session;
      console.log(formatLine(r));
      if (s) {
        // O detalhe da CLI é para leitura minuciosa; todos os números com separador de milhar
        console.log(`sessao: saida ${fmtNum(s.totalOutput)}${s.totalReasoning ? `(+${fmtNum(s.totalReasoning)} raciocinio)` : ""} tok · entrada ${fmtNum(s.totalInput)} tok (cache ${fmtNum(s.totalCacheRead)}) · ${s.requests} req`);
      }
    }
  }
}

export { query, queryTurn, formatLine, formatTurnLine, fmtCompact, fmtNum };
