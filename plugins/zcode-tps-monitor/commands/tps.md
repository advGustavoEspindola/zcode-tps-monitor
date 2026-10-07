---
description: Ver throughput de TPS, percentis de latência, taxa de erro e instantâneo de recursos do sistema
---

Use o plugin zcode-tps-monitor para obter as métricas de throughput e apresentá-las claramente em português do Brasil.

Etapas de execução:

1. Chame prioritariamente a ferramenta MCP `tps_snapshot` (instantâneo imediato).
2. Se o usuário informar um argumento numérico (ex.: `/tps 10`), use em vez disso `tps_watch`, definindo seconds com esse número (entre 2 e 30), e apresente as estatísticas de amostragem (média/pico).
3. Se o usuário estiver perguntando sobre a **taxa de tokens** (e não o TPS de negócio), execute em vez disso o script de taxa de tokens (`../../scripts/token-rate.mjs` no mesmo diretório deste arquivo de comando):
   - `node ../../scripts/token-rate.mjs` — requisição mais recente + acumulado da sessão;
   - `node ../../scripts/token-rate.mjs --turn --current` — estatística instantânea da pergunta mais recente (atual).
4. Se a ferramenta MCP não estiver disponível, volte para o script de coleta: `scripts/collect.mjs` no diretório do plugin (ou seja, `../../scripts/collect.mjs` a partir do base directory deste skill); acrescente `--watch N` para fazer amostragem.

Requisitos de apresentação:

- Apresente em lista ou tabela: TPS, latências p50/p95/p99, taxa de erro, CPU, memória.
- Informe o modo dos dados: remote (endpoint real) ou demo (dados de demonstração). Se for demo, lembre o usuário de que ele pode configurar metrics_url em Configurações → Gerenciamento de plugins → zcode-tps-monitor para conectar uma fonte de dados real.

Solicitação adicional do usuário: $ARGUMENTS
