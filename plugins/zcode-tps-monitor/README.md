# zcode-tps-monitor

A apresentação do projeto, a instalação e as instruções de uso estão no [README da página inicial do repositório](../../README.md). Este documento é voltado à estrutura interna do plugin e ao desenvolvimento/teste.

## Visão das capacidades

| Formato | Entrada | Descrição |
|---|---|---|
| Estatística da pergunta atual | `hooks/prompt-submit.mjs` + `scripts/token-rate.mjs` | A cada turno injeta a "instrução de estatística da pergunta atual": o modelo executa `token-rate.mjs --turn --current` ao encerrar a resposta e anexa a linha de taxa instantânea da pergunta atual ao final da resposta; a proteção `--current` garante que a pergunta anterior nunca seja exibida. `{"tokenRateLine": false}` desativa tudo |
| Injeção de contexto | `hooks/prompt-submit.mjs` | A cada turno lê o banco de dados de uso do ZCode e injeta a taxa do turno anterior como referência interna do modelo (marcada como "não exibir"); é desativada junto com tokenRateLine |
| Aviso de sessão | `hooks/session-start.mjs` | Ao iniciar a sessão, registra o ID da sessão e injeta um aviso de uso (explicação do mecanismo de autoteste ao encerrar); inicia `ensure-ui.mjs` em segundo plano |
| Bootstrap do UI | `hooks/ensure-ui.mjs` | Após o SessionStart, garante em segundo plano que o painel (dashboard) em `:7423` e a barra de tok/s no desktop estejam em execução (só inicia se estiverem ausentes; falhas são silenciosas) |
| Autodiagnóstico | `/tps-doctor` (`scripts/doctor.mjs`) | Verifica a versão do Node, o banco de dados e o esquema das tabelas, os arquivos de estado/configuração e o processo do dashboard; `--json` permite consumo programático |
| Dashboard em tempo real | `dashboard/server.mjs` | Painel de monitoramento no navegador, com atualização automática a cada segundo, incluindo o cartão em tempo real da "pergunta mais recente (pergunta atual)"; iniciado por `/zcode-tps-monitor:dashboard` ou executado manualmente |
| Barra de tok/s | `dashboard/overlay.ps1` | No Windows, uma StatsLine fixada na parte inferior do composer do ZCode (estilo DSH): texto cinza, sem fundo, instância única, acompanhando a janela principal |
| Comando slash | `/zcode-tps-monitor:tps` | Instantâneo imediato; `/zcode-tps-monitor:tps 10` faz amostragem por 10 segundos |
| Skill | `zcode-tps-monitor` | Acionado automaticamente quando o usuário pergunta sobre taxa/TPS |
| Ferramentas MCP | `tps_snapshot` / `tps_watch` | Servidor MCP via stdio (`mcp/tps-server.mjs`), para o agent obter dados programaticamente |
| Stop hook (experimental) | `hooks/stop.mjs` | O cliente agora dispara o evento Stop, mas o momento é imprevisível (observado disparando no meio de turnos); por padrão apenas mantém o arquivo de estado e não sobrescreve o timestamp da pergunta; `{"stopHookLine": true}` ativa a exibição direta (uma vez por turno) |

## Fontes de dados

### Taxa de tokens (real, ativada por padrão)

Calculada pelos hooks a partir do banco de dados de uso do ZCode (tabela `model_usage`); pode ser verificada manualmente:

```bash
node scripts/token-rate.mjs                  # requisição mais recente + estatísticas da sessão
node scripts/token-rate.mjs --turn --current # estatística instantânea da pergunta mais recente (atual); sem dados, não há saída
node scripts/token-rate.mjs --json           # JSON
```

É possível definir a variável de ambiente `ZCODE_SESSION_ID` para contar apenas a sessão atual (os hooks já fazem isso automaticamente).

O caminho do banco de dados é resolvido, por padrão, a partir do diretório pessoal do usuário (`~/.zcode/cli/db/db.sqlite`, o mesmo no Windows) e pode ser sobrescrito pela variável de ambiente `ZCODE_USAGE_DB`; o banco WAL é aberto em modo somente leitura, sem afetar o cliente em execução.

### TPS de negócio (demo / remote)

- **demo (padrão)**: dados simulados embutidos (random walk, valores contínuos e realistas), pronto para uso imediato.
- **remote (real)**: configure `metrics_url` em **Configurações → Gerenciamento de plugins → zcode-tps-monitor**,
  apontando para qualquer endpoint de métricas que retorne JSON. Os campos são compatíveis (até três níveis de aninhamento):
  - Vazão: `tps` / `qps` / `throughput` / `transactionsPerSecond`
  - Latência: `p50` / `p95` / `p99` (ou `latency_p50` etc.)
  - Taxa de erro: `error_rate` / `errorRate` / `err_rate`

  Exemplo: `{"data":{"tps":1240,"p50":11,"p95":28,"p99":46,"error_rate":0.05}}`

## Desenvolvimento e testes

```bash
# Dashboard em tempo real (padrão http://127.0.0.1:7423; sai sozinho após 180 minutos ocioso, --idle-exit 0 desativa)
node dashboard/server.mjs
node dashboard/server.mjs --port 8080
node dashboard/server.mjs --idle-exit 30
TPS_URL=http://host/metrics node dashboard/server.mjs   # conecta a uma fonte de dados real

# Autodiagnóstico
node scripts/doctor.mjs             # legível para humanos (itens ❌ trazem sugestões de correção)
node scripts/doctor.mjs --json      # JSON; código de saída 1 em caso de falha

# CLI de coleta do TPS de negócio
node scripts/collect.mjs            # instantâneo legível para humanos
node scripts/collect.mjs --json     # JSON
node scripts/collect.mjs --watch 5  # amostra por 5 segundos

# Testes unitários (raiz do repositório; fixture com banco temporário, não lê dados reais)
node --test
```

```bash
# Smoke test do servidor MCP
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node mcp/tps-server.mjs
```
## Estrutura de diretórios

```
zcode-tps-monitor/
├── .zcode-plugin/plugin.json   # manifesto do plugin (name / userConfig)
├── .claude-plugin/plugin.json  # manifesto de compatibilidade
├── .mcp.json                   # registro do servidor MCP (${ZCODE_PLUGIN_ROOT})
├── commands/tps.md             # /zcode-tps-monitor:tps
├── commands/dashboard.md       # /zcode-tps-monitor:dashboard
├── commands/tps-doctor.md      # /zcode-tps-monitor:tps-doctor
├── skills/zcode-tps-monitor/SKILL.md  # skill de acionamento automático
├── hooks/hooks.json            # registro dos hooks (SessionStart + UserPromptSubmit + Stop)
├── hooks/session-start.mjs     # início da sessão: registra o ID da sessão + aviso de uso
├── hooks/prompt-submit.mjs     # a cada turno: registra o momento da pergunta + injeta a referência do turno anterior + a instrução de estatística da pergunta atual
├── hooks/stop.mjs              # agora é disparado pelo cliente; mantém o arquivo de estado (preserva promptTs); exibição direta desativada por padrão
├── mcp/tps-server.mjs          # servidor MCP via stdio
├── dashboard/
│   ├── server.mjs              # servidor HTTP (página + /api/metrics)
│   ├── index.html              # layout do dashboard (puro nativo, sem dependências externas)
│   └── overlay.ps1             # barra flutuante do Windows
├── scripts/
│   ├── token-rate.mjs          # CLI de taxa de tokens (legível para humanos / --json)
│   ├── collect.mjs             # entrada do CLI de TPS de negócio
│   ├── doctor.mjs              # autodiagnóstico (legível para humanos / --json)
│   └── lib/collect-core.mjs    # núcleo de coleta (compartilhado por CLI/MCP, zero dependências)
└── docs/
    └── effect-token-rate.png   # captura de tela do resultado
```

## Aplicando as modificações

Em **Configurações → Gerenciamento de plugins**, reinstale/atualize o plugin e reabra a sessão para que os hooks sejam registrados novamente. Requer Node ≥ 22.5 (é necessário o `node:sqlite` embutido).

## Licença

[MIT](../../LICENSE)
