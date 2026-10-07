#!/usr/bin/env node
// Ponto de entrada de coleta via CLI:
//   node collect.mjs             instantâneo (legível por humanos)
//   node collect.mjs --json      saída em JSON
//   node collect.mjs --watch 5   amostra por 5 segundos (2-60)
// A variável de ambiente TPS_URL aponta para uma interface de métricas que retorna JSON; se não definida, usa dados de demonstração.

import { snapshot, watch, formatSnapshot, formatWatch } from "./lib/collect-core.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const watchIdx = args.indexOf("--watch");
const seconds = watchIdx !== -1 ? Number(args[watchIdx + 1]) || 5 : null;

try {
  const data = seconds ? await watch(seconds) : await snapshot();
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(seconds ? formatWatch(data) : formatSnapshot(data));
  }
} catch (err) {
  console.error(`[zcode-tps-monitor] Falha na coleta: ${err.message}`);
  process.exit(1);
}
