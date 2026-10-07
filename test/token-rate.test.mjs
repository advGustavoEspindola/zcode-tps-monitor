// Testes unitários: node --test test/
// Usa um banco SQLite temporário como fixture, definindo ZCODE_USAGE_DB antes de importar o módulo em teste.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.removeAllListeners("warning");
process.on("warning", () => {});

const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plugins", "zcode-tps-monitor");

// --- Banco fixture (precisa estar pronto antes de importar token-rate.mjs; o módulo lê caminho/ambiente no carregamento) ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tps-test-"));
const dbFile = path.join(tmp, "db.sqlite");
process.env.ZCODE_USAGE_DB = dbFile;
process.env.TOKEN_RATE_WINDOW = "5";
process.env.TOKEN_RATE_HIST = "10";
process.env.TOKEN_RATE_MIN_MS = "100";
process.env.TOKEN_RATE_MAX_MS = "60000";
// Arquivo de estado do hook lido pelo guarda --current: aponta para o fixture, evitando ler o ~/.zcode real
process.env.TPS_MONITOR_STATE_FILE = path.join(tmp, "state.json");

const { DatabaseSync } = await import("node:sqlite");
{
  const db = new DatabaseSync(dbFile);
  db.exec(`CREATE TABLE model_usage (
    session_id TEXT, status TEXT, query_source TEXT, model_id TEXT,
    output_tokens INTEGER, reasoning_tokens INTEGER, input_tokens INTEGER, cache_read_input_tokens INTEGER,
    first_token_at INTEGER, completed_at INTEGER, time_to_first_token_ms INTEGER, turn_id TEXT)`);
  const ins = db.prepare(
    "INSERT INTO model_usage VALUES (?, 'completed', 'main_turn', 'test-model', ?, ?, 120000, 118000, ?, ?, ?, ?)"
  );
  // Timestamps em milissegundos de época reais (o guarda --current compara com o momento da pergunta; precisa ter a mesma dimensão)
  const T0 = Date.now() - 60000;
  // Taxa = (output + reasoning) / genMs; turn_id agrupa por turno do usuário; turno atual = último turn_id
  ins.run("s1", 500, 100, T0 + 1000, T0 + 2000, 800, "t_old");  // gen 1000ms → 600 tok/s (verifica que token de raciocínio entra no numerador)
  ins.run("s1", 900, 0, T0 + 2000, T0 + 5000, 700, "t_old");    // gen 3000ms → 300 tok/s
  ins.run("s1", 80, 0, T0 + 6500, T0 + 7000, 450, "t_new");     // gen 500ms  → 160 tok/s (segmento 1 deste turno)
  ins.run("s1", 20, 0, T0 + 7550, T0 + 7600, 100, "t_new");     // gen 50ms < MIN → sem taxa, mas conta no acumulado
  ins.run("s1", 220, 0, T0 + 9000, T0 + 10100, 600, "t_new");   // gen 1100ms → 200 tok/s (segmento 2 deste turno = mais recente da sessão)
  // Não main_turn: deve ser excluído quando há conversa principal
  db.exec(`INSERT INTO model_usage VALUES ('s1', 'completed', 'sub', 'test-model', 999, 0, 120000, 118000, ${T0 + 8000}, ${T0 + 9000}, 500, 't_new')`);
  // Requisição concluída atualizada em outra sessão: verifica que, sem sessão explícita, o arquivo de estado tem prioridade sobre a "mais recente global"
  db.exec(`INSERT INTO model_usage VALUES ('s_other', 'completed', 'main_turn', 'test-model', 100, 0, 120000, 118000, ${T0 + 12000}, ${T0 + 13000}, 500, 't_x')`);
  db.close();
}

const { query, queryTurn, formatLine, formatTurnLine, fmtCompact, fmtNum } = await import(pathToFileURL(path.join(PLUGIN, "scripts", "token-rate.mjs")).href);

// --- Regras de conversão ---
test("fmtCompact por faixas: <1k sem decimal, 1k~10k com uma casa decimal, 10k~1M arredondado em k, ≥1M com uma casa decimal em M", () => {
  assert.equal(fmtCompact(999), "999");
  assert.equal(fmtCompact(1600), "1.6k");
  assert.equal(fmtCompact(9800), "9.8k");
  assert.equal(fmtCompact(51300), "51k");
  assert.equal(fmtCompact(128600), "129k");
  assert.equal(fmtCompact(73818000), "73.8M");
  assert.equal(fmtCompact(2000000), "2.0M");
});

test("fmtNum separador de milhar", () => {
  assert.equal(fmtNum(2762), "2,762");
  assert.equal(fmtNum(128643), "128,643");
  assert.equal(fmtNum(275), "275");
});

test("Taxa inclui token de raciocínio: 600 = (500+100)/1s", () => {
  const r = query("s1");
  const first = r.history[0]; // o mais antigo
  assert.equal(first.outputTokens, 500);
  assert.equal(first.tokPerSec, 600);
});

test("Cabeçalho pega a amostra válida mais recente e exclui linhas inválidas e não principais", () => {
  const r = query("s1");
  assert.equal(r.latest.tokPerSec, 200);       // o válido mais recente é o segmento 2 deste turno (gen 1100ms), e não a linha gen 50ms / sub
  assert.ok(r.history.every((h) => h.outputTokens !== 999)); // linha sub foi filtrada
  const invalid = r.history.find((h) => h.outputTokens === 20);
  assert.equal(invalid.tokPerSec, null);        // geração curta demais não tem taxa
});

test("Estatísticas da janela e acumulado da sessão (SUM independente, não limitado pela janela)", () => {
  const r = query("s1");
  assert.equal(r.session.samples, 4);
  assert.equal(r.session.avg, 315);            // (600+300+160+200)/4
  assert.equal(r.session.max, 600);
  assert.equal(r.session.totalOutput, 1720);   // 500+900+80+20+220 (inclui linha de taxa inválida)
  assert.equal(r.session.totalReasoning, 100);
  assert.equal(r.session.requests, 5);         // 5 linhas main_turn (sub não conta)
  assert.equal(r.session.turns, 2);            // t_old + t_new(COUNT DISTINCT turn_id)
  assert.equal(r.session.avgTtftMs, 530);      // (800+700+450+100+600)/5
});

test("Texto da linha: marcação do turno anterior, token de raciocínio, acumulado da sessão", () => {
  const line = formatLine(query("s1"));
  assert.match(line, /\(turno anterior\)/);
  assert.match(line, /med\. 4 315 \/ pico 600/);
  assert.match(line, /acumulado 1\.8k tok/);    // 1720+100
});

test("Estatísticas deste turno: recorte pelo turn_id mais recente, taxa ponderada de múltiplos segmentos", () => {
  const r = queryTurn("s1");
  assert.equal(r.turnId, "t_new");             // considera apenas o turno mais recente, sem os dois segmentos de t_old
  assert.equal(r.turn.requests, 3);            // 160 + 50ms inválido + 200
  assert.equal(r.turn.rated, 2);
  assert.equal(r.turn.totalOutput, 320);       // 80+20+220
  assert.equal(r.turn.ttftMs, 450);            // tempo até o primeiro token do primeiro segmento deste turno
  // Ponderado: segmento válido 300 tok / 1600ms → 187.5 (produção total / duração total de geração, e não a média das taxas por segmento)
  assert.equal(r.turn.tokPerSec, 187.5);
  assert.equal(r.turn.peak, 200);
  assert.equal(r.session.samples, 4);          // o acumulado da sessão ainda considera toda a sessão
});

test("Texto deste turno: marcação do turno atual, número de etapas e pico, acumulado da sessão", () => {
  const line = formatTurnLine(queryTurn("s1"));
  assert.match(line, /⚡ 187\.5 tok\/s \(este turno\)/);
  assert.match(line, /TTFT 0\.5s/);
  assert.match(line, /saida 320 tok \/ geracao/);
  assert.match(line, /3 etapas \/ pico 200/);
  assert.match(line, /acumulado 1\.8k tok/);
});

test("Guarda --current: momento da pergunta posterior a todos os dados do turno → não retorna este turno (nunca usa o turno anterior como este)", () => {
  fs.writeFileSync(
    process.env.TPS_MONITOR_STATE_FILE,
    JSON.stringify({ sessionId: "s1", ts: Date.now() + 60000, source: "test" })
  );
  const r = queryTurn("s1", { current: true });
  assert.equal(r.noCurrentTurnData, true);
  assert.equal(r.turn, null);
  assert.equal(formatTurnLine(r), "sem dados deste turno");
});

test("Guarda --current: já há dados deste turno no banco → retorna normalmente", () => {
  fs.writeFileSync(
    process.env.TPS_MONITOR_STATE_FILE,
    JSON.stringify({ sessionId: "s1", ts: Date.now() - 55000, source: "test" })
  );
  const r = queryTurn("s1", { current: true });
  assert.equal(r.noCurrentTurnData, undefined);
  assert.equal(r.turn.tokPerSec, 187.5);
});

test("Guarda --current: mesmo após o hook Stop atualizar o arquivo de estado, ainda usa promptTs (momento da pergunta)", () => {
  // Incidente real de 2026-10-04: o cliente disparou Stop durante o turno em andamento, e o stop.mjs reescreveu ts para o
  // momento do disparo, fazendo o guarda concluir erradamente "sem dados deste turno". Após a correção, promptTs preserva
  // o momento da pergunta e o guarda considera só ele.
  fs.writeFileSync(
    process.env.TPS_MONITOR_STATE_FILE,
    JSON.stringify({
      sessionId: "s1",
      ts: Date.now() + 60000,        // momento do disparo do Stop foi escrito como muito tarde (posterior a todos os dados)
      promptTs: Date.now() - 55000,  // momento da pergunta é anterior aos dados deste turno → o guarda deve deixar passar
      source: "stop",
    })
  );
  const r = queryTurn("s1", { current: true });
  assert.equal(r.noCurrentTurnData, undefined);
  assert.equal(r.turn.tokPerSec, 187.5);
});

test("Sem sessão explícita, prioriza a sessão do arquivo de estado (e não a requisição concluída mais recente global)", () => {
  fs.writeFileSync(
    process.env.TPS_MONITOR_STATE_FILE,
    JSON.stringify({ sessionId: "s1", ts: Date.now(), source: "test" })
  );
  // A requisição concluída mais recente global pertence a s_other; o arquivo de estado aponta para s1 → deve-se escolher s1
  assert.equal(queryTurn(null).sessionId, "s1");
  assert.equal(query(null).sessionId, "s1");
});

test("Banco antigo sem coluna turn_id: consulta deste turno degrada graciosamente sem lançar erro", async () => {
  const legacyFile = path.join(tmp, "legacy.sqlite");
  const db = new DatabaseSync(legacyFile);
  db.exec(`CREATE TABLE model_usage (
    session_id TEXT, status TEXT, query_source TEXT, model_id TEXT,
    output_tokens INTEGER, reasoning_tokens INTEGER, input_tokens INTEGER, cache_read_input_tokens INTEGER,
    first_token_at INTEGER, completed_at INTEGER, time_to_first_token_ms INTEGER)`);
  db.exec("INSERT INTO model_usage VALUES ('s2', 'completed', 'main_turn', 'm', 100, 0, 100000, 99000, 1000, 2000, 500)");
  db.close();
  // O caminho do DB é lido no carregamento do módulo: reimporta uma instância do módulo com query apontando para o banco antigo
  process.env.ZCODE_USAGE_DB = legacyFile;
  try {
    const legacy = await import(pathToFileURL(path.join(PLUGIN, "scripts", "token-rate.mjs")).href + "?legacy");
    const r = legacy.queryTurn("s2");
    assert.equal(r.turnId, null);
    assert.equal(r.turn, null);
    assert.equal(r.session.samples, 1);        // estatísticas da sessão não são afetadas
  } finally {
    process.env.ZCODE_USAGE_DB = dbFile;
  }
});

// --- doctor: no ambiente fixture deve ficar tudo verde ---
test("doctor: ambiente fixture passa em todas as verificações", async () => {
  fs.mkdirSync(path.join(tmp, ".zcode"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".zcode", "tps-monitor.last-session.json"),
    JSON.stringify({ sessionId: "sess_test", ts: Date.now(), source: "test" }));
  process.env.ZCODE_USAGE_DB = dbFile; // o doctor também lê essa variável no carregamento
  // O doctor resolve o diretório de estado ~/.zcode com os.homedir() no carregamento do módulo: aponta temporariamente
  // HOME/USERPROFILE para o diretório do fixture, isolando o ambiente (POSIX lê HOME, Windows lê USERPROFILE),
  // caso contrário a verificação do "arquivo de estado da sessão" falha em um ambiente limpo sem ~/.zcode (CI)
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  try {
    const { runDoctor } = await import(pathToFileURL(path.join(PLUGIN, "scripts", "doctor.mjs")).href);
    const report = await runDoctor();
    assert.equal(report.failed, 0, JSON.stringify(report.checks, null, 2));
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
  }
});
