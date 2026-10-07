---
name: zcode-tps-monitor
description: Monitoramento de taxa de saída de token e throughput (vazão). Use quando o usuário perguntar sobre taxa de token, velocidade de geração, tok/s, rapidez da saída do modelo, TTFT (latência do primeiro token), ou TPS, QPS, throughput/vazão, latência de interface, ou quiser ver o dashboard de monitoramento em tempo real. A taxa de token lê o banco de dados de uso do ZCode e é dado real; o TPS de negócio aceita um endpoint de métricas ou dados de demonstração.
---

# TPS Monitor (taxa de tokens + throughput de negócio)

Há dois tipos de métricas:

- **Taxa de saída de tokens (real)** — calculada a partir do próprio banco de dados de uso do ZCode (tabela `model_usage`): tok/s por turno, número de tokens de saída, tempo de geração, TTFT, média/pico da sessão. Use esta quando o usuário perguntar "velocidade de geração/taxa de tokens/tok/s".
- **TPS de negócio (demo/remote)** — sem endpoint configurado, são dados de demonstração; com `metrics_url` configurado, é o throughput real do negócio.

## Como obter os dados

1. Taxa de tokens (recomendada, dados reais):
   ```
   node <diretório do plugin>/scripts/token-rate.mjs                  # requisição mais recente + estatísticas da sessão
   node <diretório do plugin>/scripts/token-rate.mjs --turn --current # estatística instantânea da pergunta mais recente (atual)
   node <diretório do plugin>/scripts/token-rate.mjs --json           # JSON
   ```
   É possível definir a variável de ambiente `ZCODE_SESSION_ID` para contar apenas a sessão atual; os hooks já fazem isso automaticamente.
2. TPS de negócio: ferramentas MCP `tps_snapshot`/`tps_watch`, ou `node <diretório do plugin>/scripts/collect.mjs [--watch N]`.
3. Dashboard em tempo real (no navegador, com o painel de taxa de tokens e a taxa em andamento da pergunta atual):
   ```
   node <diretório do plugin>/dashboard/server.mjs   # http://127.0.0.1:7423
   ```

## Regras de apresentação

- Responda em português do Brasil, apresentando as métricas em tabelas ou listas; na taxa de tokens, informe o nome do modelo; se o TTFT estiver claramente alto (>5s) ou a taxa despencar, inclua um breve comentário.
- Se o contexto contiver a marcação `[estatistica deste turno]`: primeiro execute o script e depois produza a resposta completa, colocando a linha de saída literalmente em um bloco de citação no final exato dessa resposta; a linha de estatística nunca deve vir como mensagem isolada, e nenhuma ferramenta deve ser chamada depois de o corpo do texto estar pronto (o cliente recolhe mensagens com ferramentas); se o script não retornar saída, não exiba nenhuma linha de estatística.
- As linhas de taxa históricas com o prefixo `[contexto interno · nao mostrar]` no contexto servem apenas para dar background e nunca devem ser mostradas ao usuário.
- No modo demo, o TPS de negócio deve ser sinalizado explicitamente, com o aviso de que é possível configurar `metrics_url`.
