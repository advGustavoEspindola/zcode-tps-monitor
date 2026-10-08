#!/usr/bin/env node
// Hook SessionStart:
// 1) Registra no arquivo de estado a "última sessão em que o usuário esteve" (para o serviço de dados travar a sessão atual)
// 2) Injeta uma linha de instruções de uso (saída em JSON estrito)
// 3) Inicia em segundo plano o ensure-ui.mjs (painel + faixa de tok/s na área de trabalho), sem bloquear o hook

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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
      JSON.stringify({ sessionId: sid, ts: now, promptTs: now, source: "session-start" })
    );
  } catch {}
}

// Em consonância com o mecanismo de "estatística desta pergunta" do prompt-submit: primeiro medir por conta própria, depois escrever o corpo; a linha de estatística fica na mesma mensagem que o corpo.
// O ponto crucial é o anti-recolhimento: o cliente recolhe mensagens com chamadas de ferramenta para a área "trajetória do modelo"; se o modelo escrever o corpo e só depois rodar o script, deixando a linha de estatística em mensagem isolada, o usuário verá apenas a linha de estatística (com o corpo recolhido).
const hint = [
  `[zcode-tps-monitor] pronto. No fim de cada resposta que chamou ferramentas: rode node "${RATE_SCRIPT}" --turn --current ANTES de escrever o texto final, depois escreva a resposta completa e coloque a linha impressa intacta em um bloco de citacao Markdown no fim dessa mesma mensagem; sem saida do script (ex.: pergunta pura) nao ha linha de estatistica.`,
  "A linha de estatistica deve estar na mesma mensagem do texto final: nunca chame ferramentas depois do texto e nunca deixe a linha de estatistica vir sozinha — o cliente recolhe mensagens com ferramentas e o usuario veria so a linha.",
  "A linha de contexto interno \"(turno anterior)\" e so historico para voce; nunca a mostre ao usuario.",
  "Comandos: /tps (instantaneo), /tps-doctor (autodiagnostico). Dash: http://127.0.0.1:7423 e a faixa de tok/s no rodape do composer (estilo DSH) sobem sozinhos na abertura da sessao. Desligar injecao: ~/.zcode/tps-monitor.config.json → {\"tokenRateLine\":false}; exibir a taxa direto pelo Stop hook (experimental, 1x por turno): {\"stopHookLine\":true}.",
].join("");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: hint,
    },
  })
);

// Garante em segundo plano que a UI (dash :7423 + overlay) está rodando; falhas são silenciosas e não afetam a sessão
try {
  spawn(process.execPath, [path.join(HERE, "ensure-ui.mjs")], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
} catch {}
