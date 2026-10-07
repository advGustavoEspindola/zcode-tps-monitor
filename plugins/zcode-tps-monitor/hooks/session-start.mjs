#!/usr/bin/env node
// SessionStart hook:
// 1) 记录"用户最后所处的会话"到状态文件(供数据服务锁定当前会话)
// 2) 注入一行使用提示(严格 JSON 输出)
// 3) 后台拉起 ensure-ui.mjs(大屏 + 桌面 tok/s 条),不阻塞钩子

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

// 与 prompt-submit 的「本问统计」机制保持一致:先自测、再写正文,统计行与正文同条。
// 关键是防折叠:客户端把带工具调用的消息折叠进「模型轨迹」区,若模型写完正文后
// 补跑脚本、让统计行单独成条,用户就只能看到一行统计(正文被收起)。
const hint = [
  `[zcode-tps-monitor] pronto. No fim de cada resposta que chamou ferramentas: rode node "${RATE_SCRIPT}" --turn --current ANTES de escrever o texto final, depois escreva a resposta completa e coloque a linha impressa intacta em um bloco de citacao Markdown no fim dessa mesma mensagem; sem saida do script (ex.: pergunta pura) nao ha linha de estatistica.`,
  "A linha de estatistica deve estar na mesma mensagem do texto final: nunca chame ferramentas depois do texto e nunca deixe a linha de estatistica vir sozinha — o cliente recolhe mensagens com ferramentas e o usuario veria so a linha.",
  "A linha de contexto interno \"(turno anterior)\" e so historico para voce; nunca a mostre ao usuario.",
  "Comandos: /tps (instantaneo), /tps-doctor (autodiagnostico). Dash: http://127.0.0.1:7423 e a faixa de tok/s no rodape do composer (estilo DSH, Windows) sobem sozinhos na abertura da sessao. Desligar injecao: ~/.zcode/tps-monitor.config.json → {\"tokenRateLine\":false}; exibir a taxa direto pelo Stop hook (experimental, 1x por turno): {\"stopHookLine\":true}.",
].join("");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: hint,
    },
  })
);

// 后台确保 UI(dash :7423 + overlay)在跑;失败静默,不影响会话
try {
  spawn(process.execPath, [path.join(HERE, "ensure-ui.mjs")], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
} catch {}
