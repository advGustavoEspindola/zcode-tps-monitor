#!/usr/bin/env node
// UserPromptSubmit hook: 每次用户发消息时
// 1) 记录"用户最后所处的会话"与提问时间戳到状态文件(--current 守卫依赖该时间戳)
// 2) 注入上一轮速率作为模型上下文,并下达"本问统计"指令:
//    模型在写最终回复正文之前运行 token-rate.mjs --turn --current,把输出的"本问"速率行
//    原样引用在同一条回复的最末尾。--current 保证绝不把上一轮数据冒充本问(纯问答轮无输出)。
// 输出必须为严格 JSON。
// 可选配置 ~/.zcode/tps-monitor.config.json:
//   {"tokenRateLine": false} 关闭全部速率注入。

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
      // promptTs:本次提问时刻,--current 守卫的唯一依据;Stop 钩子触发时会保留它而非覆盖
      JSON.stringify({ sessionId: sid, ts: now, promptTs: now, source: "prompt-submit" })
    );
  } catch {}
}

// 本问统计指令(防折叠,0.8.4 起的严格顺序):模型在写最终回复正文之前自测当前提问的速率,
// 统计行与回复正文同处最后一条消息。客户端把带工具调用的消息折叠进「模型轨迹」区,
// 只有轮次最后一条纯文字消息默认展开——若模型先写完正文再补跑脚本、让统计行单独成条,
// 用户就只能看到一行统计(正文全被收起)。故指令严格规定顺序并给出降级规则。
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
    // 上一轮行仅作模型上下文(加 [contexto interno · nao mostrar] 前缀,明确禁止展示);
    // 本问统计由模型按指令在写正文之前自测
    emit("[contexto interno · nao mostrar] resposta anterior: " + formatLine(query(sid || null)) + TURN_STATS_INSTRUCTION);
  }
} catch {
  emit("");
}
