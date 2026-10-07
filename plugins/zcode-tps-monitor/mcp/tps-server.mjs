#!/usr/bin/env node
// Servidor MCP stdio do zcode-tps-monitor. A implementação do protocolo segue a compatibilidade
// do example-plugin oficial com frames Content-Length + JSON por linha; a lógica de negócio
// reutiliza scripts/lib/collect-core.mjs.
//
// Teste de fumaça manual:
//   printf '%s\n' \
//     '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
//     '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
//     | node mcp/tps-server.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshot, watch, formatSnapshot, formatWatch } from "../scripts/lib/collect-core.mjs";

// O número de versão segue automaticamente o manifesto do plugin, para não divergir da versão do plugin
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let VERSION = "0.0.0";
try {
  VERSION = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".zcode-plugin", "plugin.json"), "utf8")).version;
} catch {}
const SERVER_INFO = { name: "zcode-tps-monitor", version: VERSION };

const TOOLS = [
  {
    name: "tps_snapshot",
    description:
      "Obtém um snapshot de vazão de TPS: TPS atual, latências p50/p95/p99, taxa de erros e uso de CPU/memória locais. Não requer parâmetros.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tps_watch",
    description:
      "Observa o TPS por um período, amostrando a cada segundo, e retorna estatísticas de média/mínimo/máximo, latência e taxa de erros. seconds: 2-30, padrão 5.",
    inputSchema: {
      type: "object",
      properties: {
        seconds: { type: "integer", minimum: 2, maximum: 30, description: "Segundos de amostragem" },
      },
    },
  },
];

function writeMessage(message) {
  const body = JSON.stringify(message);
  // Frame MCP stdio: cabeçalho Content-Length + corpo (também compatível com linhas JSON simples de clientes básicos)
  const payload = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
  process.stdout.write(payload);
}

const ok = (id, result) => writeMessage({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) =>
  writeMessage({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handleRequest(msg) {
  const { id, method, params } = msg;

  if (id === undefined || id === null) {
    return; // notificações (ex.: initialized) são ignoradas
  }

  switch (method) {
    case "initialize":
      ok(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      return;
    case "ping":
      ok(id, {});
      return;
    case "tools/list":
      ok(id, { tools: TOOLS });
      return;
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments || {};
      try {
        if (name === "tps_snapshot") {
          const s = await snapshot();
          ok(id, { content: [{ type: "text", text: formatSnapshot(s) }], isError: false });
        } else if (name === "tps_watch") {
          const sec = Math.min(30, Math.max(2, Number(args.seconds) || 5));
          const w = await watch(sec);
          ok(id, { content: [{ type: "text", text: formatWatch(w) }], isError: false });
        } else {
          fail(id, -32601, `Ferramenta desconhecida: ${name}`);
        }
      } catch (err) {
        ok(id, {
          content: [{ type: "text", text: `[zcode-tps-monitor] falha na coleta: ${err.message}` }],
          isError: true,
        });
      }
      return;
    }
    default:
      fail(id, -32601, `Método não encontrado: ${method}`);
  }
}

function handleRaw(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (Array.isArray(msg)) {
    for (const item of msg) handleRequest(item);
    return;
  }
  handleRequest(msg);
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      const asText = buffer.toString("utf8");
      if (asText.includes("\n") && asText.trimStart().startsWith("{")) {
        const lines = asText.split(/\r?\n/);
        buffer = Buffer.from(lines.pop() || "", "utf8");
        for (const line of lines) handleRaw(line);
      }
      break;
    }
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + Number(match[1]);
    if (buffer.length < bodyEnd) break;
    handleRaw(buffer.slice(bodyStart, bodyEnd).toString("utf8"));
    buffer = buffer.slice(bodyEnd);
  }
});

process.stdin.on("end", () => {
  if (buffer.length) handleRaw(buffer.toString("utf8"));
});

process.stderr.write("[zcode-tps-monitor] servidor MCP stdio pronto\n");
