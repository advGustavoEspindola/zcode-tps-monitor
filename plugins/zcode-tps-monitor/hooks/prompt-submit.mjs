#!/usr/bin/env node
// Hook UserPromptSubmit: executado a cada mensagem do usuário.
// 1) Registra no arquivo de estado a "última sessão em que o usuário esteve" e o timestamp da pergunta
//    (a guarda --current depende desse timestamp).
// 2) Injeta a taxa da rodada anterior como contexto do modelo e emite a instrução de "estatística desta
//    pergunta": antes de escrever o texto final da resposta, o modelo roda token-rate.mjs --turn --current
//    e cita a linha de taxa da "pergunta atual" exatamente como impressa, no fim dessa mesma resposta.
//    --current garante que os dados da rodada anterior nunca sejam apresentados como sendo desta
//    (rodadas só de perguntas e respostas não geram saída).
// A saída deve ser JSON estrito.
// Configuração opcional ~/.zcode/tps-monitor.config.json:
//   {"tokenRateLine": false} desativa toda a injeção de taxa.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query, formatLine } from "../scripts/token-rate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RATE_SCRIPT = path.join(HERE, "..", "scripts", "token-rate.mjs");

const sid = process.env.ZCODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || "";
if (sid) {
  try {
    const file = path.join(os.homedir(), ".zcode", "tps-monitor.last-session.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const now = Date.now();
    fs.writeFileSync(
      file,
      // promptTs: momento desta pergunta, único fundamento da guarda --current; quando o hook Stop dispara, ele preserva esse valor em vez de sobrescrevê-lo
      JSON.stringify({ sessionId: sid, ts: now, promptTs: now, source: "prompt-submit" })
    );
  } catch {}
}

// Instrução de estatística desta pergunta (anti-recolhimento, ordem estrita desde a 0.8.4): antes de
// escrever o texto final da resposta, o modelo mede por conta própria a taxa da pergunta atual; a linha
// de estatística fica na mesma mensagem que o texto final. O cliente recolhe mensagens com chamadas de
// ferramenta para a área "trajetória do modelo", e apenas a última mensagem de texto puro do turno vem
// expandida por padrão — se o modelo escrever o corpo primeiro e só depois rodar o script, deixando a
// linha de estatística em mensagem separada, o usuário verá apenas a linha de estatística (com todo o
// corpo recolhido). Por isso a instrução impõe a ordem rigorosamente e define uma regra de degradação.
const TURN_STATS_INSTRUCTION = [
  "",
  "[estatistica deste turno] Se voce ja chamou ferramentas nesta resposta, finalize estritamente nesta ordem:",
  `1. Antes de comecar a escrever o texto final da resposta, rode uma vez:node "${RATE_SCRIPT}" --turn --current`,
  "2. Depois escreva o texto final completo (todo o conteudo que o usuario precisa) e coloque a linha impressa pelo script intacta em um bloco de citacao Markdown (nova linha com \"> \") no fim desta mesma resposta; nao reescreva os numeros nem acrescente nada alem disso.",
  "Regra critica: a linha de estatistica deve estar na MESMA mensagem que o texto final completo. Nunca deixe a linha de estatistica (ou uma mensagem curta so com ela) ser sua ultima mensagem isolada, e nunca chame ferramentas depois de terminar o texto final — o cliente recolhe mensagens com chamadas de ferramenta para a \"trajetoria do modelo\" e o usuario veria apenas a linha de estatistica.",
  "Regra de degradacao: se o texto final ja estiver escrito e so depois voce perceber que nao rodou o script, apenas omita a linha de estatistica e termine a resposta; nao chame ferramentas depois.",
  "atencao:① a linha \"(turno anterior)\" acima (prefixo [contexto interno · nao mostrar]) e o historico da pergunta passada, so para seu contexto — nunca a mostre ao usuario;② se o script nao imprimir nenhuma linha, ou se voce nao chamou ferramentas nesta resposta, nao mostre estatistica nenhuma e nao chame o script so por isso.",
].join("\n");

function readConfig() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".zcode", "tps-monitor.config.json"), "utf8")
    );
  } catch {
    return {};
  }
}

function emit(ctx) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx } })
  );
}

try {
  const cfg = readConfig();
  if (cfg.tokenRateLine === false) {
    emit("");
  } else {
    // A linha da rodada anterior serve apenas como contexto do modelo (com o prefixo [contexto interno · nao mostrar],
    // proibindo explicitamente a exibição); a estatística desta pergunta é medida pelo próprio modelo antes de escrever o corpo
    emit("[contexto interno · nao mostrar] resposta anterior: " + formatLine(query(sid || null)) + TURN_STATS_INSTRUCTION);
  }
} catch {
  emit("");
}
