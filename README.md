<img src="assets/icon.png" align="right" width="96" alt="ícone do zcode-tps-monitor">

# zcode-tps-monitor

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.5-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

**Plugin de monitoramento da taxa de tokens em nível de sessão do ZCode.** Em toda resposta que **chamou ferramentas**, o final traz uma linha com estatísticas instantâneas de tok/s da **pergunta atual** (desta questão) — os dados vêm direto do banco de dados de usage do ZCode, sem autodescrição do modelo e sem estimativas, com uma proteção que garante **nunca exibir o turno anterior**; além de um painel (dashboard) de monitoramento em tempo real, comandos de barra, ferramentas MCP e monitoramento opcional de TPS de negócio.

> Este repositório é também um marketplace local de plugins do ZCode (nome do marketplace: `tps-local-marketplace`), e o corpo do plugin está em [`plugins/zcode-tps-monitor/`](plugins/zcode-tps-monitor/README.md).

## Prévia do efeito

Ao final de cada resposta, o modelo executa o script do plugin para medir a taxa real **desta pergunta** e anexa a linha de estatísticas no fim da resposta — turnos longos com várias etapas de chamada de ferramentas são ponderados por "produção total / tempo total de geração":

![efeito da linha de taxa de tokens](plugins/zcode-tps-monitor/docs/effect-token-rate.png)

| Campo | Significado |
|---|---|
| `537.3 tok/s (este turno)` | Taxa de saída instantânea da pergunta atual (inclui tokens de pensamento; em turnos de várias etapas, a taxa é ponderada) |
| `TTFT 3.0s` | Latência do primeiro token (TTFT, primeira etapa desta pergunta) |
| `saida 223 tok / geracao 0.4s` | Número de tokens de saída e tempo puro de geração desta pergunta (não inclui a espera por ferramentas entre etapas) |
| `2 etapas / pico 537.3` | Número de etapas de solicitação e a taxa de pico de uma etapa desta pergunta (só é exibido em turnos de várias etapas) |
| `acumulado 51.3k tok` | Saída acumulada da sessão atual (contagem independente, sem limite de janela) |
| `⏱ 10:23:04` | Momento da amostragem (após a chamada de ferramenta mais recente) |

Regras de exibição de números: em cada pergunta, "saida" usa número exato com separador de milhar (ex.: `2,762 tok`); "acumulado" usa unidade compacta — abaixo de mil, valor bruto; de 1k a 10 mil, uma casa decimal (`9.8k`); de 10 mil a 1 milhão, arredondado (`51k`); acima de 1 milhão, uma casa decimal com M (`73.8M`). Os textos da linha de taxa estão em pt-BR desde a 0.8.6 (os rótulos de exemplo são a saída atual).

## Recursos

- **Taxa de tokens real (ativada por padrão)** — ao final de cada resposta que chamou ferramentas, é anexada automaticamente a **taxa instantânea de tok/s da pergunta atual** (incluindo tokens de pensamento), a latência do primeiro token, o número de tokens de saída, o tempo de geração, o número de etapas/pico e o acumulado da sessão; a proteção `--current` garante nunca exibir dados do turno anterior como se fossem da pergunta atual
- **Painel (dashboard) de monitoramento em tempo real** — `/zcode-tps-monitor:dashboard` inicia com um clique; painel em estilo escuro de operações no navegador, com atualização automática a cada segundo; sai automaticamente após 3 horas ocioso, sem deixar processos em segundo plano
- **Comandos de barra** — `/tps` para uma fotografia instantânea; `/tps 10` para amostrar por 10 segundos; `/tps-doctor` para autodiagnóstico do ambiente
- **Ferramentas MCP** — `tps_snapshot` / `tps_watch`, para que o agent obtenha dados de forma programática
- **Barra de tok/s estilo DSH** — StatsLine permanente centralizada abaixo do composer, com a taxa atual sempre visível (Windows via `dashboard/overlay.ps1`, Linux X11 via `dashboard/overlay.py`)
- **Monitoramento de TPS de negócio (opcional)** — configure `metrics_url` para conectar a uma interface real de métricas de negócio ou use os dados de demonstração embutidos

## Instalação

### Opção 1: adicionar pelo GitHub (recomendado)

Execute no ZCode:

```text
/plugin marketplace add shy3130/zcode-tps-monitor
/plugin install zcode-tps-monitor@tps-local-marketplace
```

### Opção 2: diretório local

Após clonar este repositório, abra no ZCode **Configurações → Gerenciamento de plugins → Descobrir → +**, escolha "diretório local" como origem e aponte para a raiz do repositório.

## Atualização

```text
/plugin marketplace update tps-local-marketplace
```

Depois de atualizar, reinstale/atualize o plugin e reabra a sessão para que os hooks sejam registrados novamente.

## Uso

| Cenário | Ação |
|---|---|
| Ver a taxa da pergunta atual | Nenhuma ação necessária: em respostas que chamaram ferramentas, a linha de estatísticas da pergunta atual é anexada automaticamente no final (não é exibida em respostas sem chamada de ferramentas) |
| Fotografia instantânea | Digite `/tps`; ou `/tps 10` para amostrar continuamente por 10 segundos |
| Abrir o painel de monitoramento | Digite `/zcode-tps-monitor:dashboard`, ou manualmente `node dashboard/server.mjs` |
| Autodiagnóstico do ambiente | A linha de taxa desapareceu? Digite `/tps-doctor` para verificar item a item |
| Desativar a injeção da taxa (incluindo a linha de estatísticas no final) | Escreva `{"tokenRateLine": false}` em `~/.zcode/tps-monitor.config.json`; reabra a sessão para surtir efeito |
| Barra de tok/s estilo DSH | Automática via hook (Windows: `dashboard/overlay.ps1`, Linux X11: `dashboard/overlay.py`); ou manual com o mesmo comando |
| Obtenção de dados pelo agent | Ferramentas MCP `tps_snapshot` / `tps_watch` |

Requer Node ≥ 22.5 (é necessário o `node:sqlite` embutido; o mesmo vale para Windows / macOS / Linux).

## Configuração: conectar ao TPS de negócio (opcional)

Por padrão, o plugin fornece dados de demonstração; para monitorar a vazão real de negócio, configure `metrics_url` em **Configurações → Gerenciamento de plugins → zcode-tps-monitor**, apontando para qualquer interface de métricas que retorne JSON. Os campos são compatíveis automaticamente (suporta até três níveis de aninhamento):

| Métrica | Nomes de campo reconhecidos |
|---|---|
| Vazão | `tps` / `qps` / `throughput` / `transactionsPerSecond` |
| Latência | `p50` / `p95` / `p99` (ou `latency_p50`, etc.) |
| Taxa de erro | `error_rate` / `errorRate` / `err_rate` |

Exemplo de retorno da interface:

```json
{"data":{"tps":1240,"p50":11,"p95":28,"p99":46,"error_rate":0.05}}
```

## Como funciona

```
Usuário envia uma mensagem
   │
   ▼
Hook UserPromptSubmit
   │  Registra o momento da pergunta no arquivo de estado; injeta a taxa do turno
   │  anterior (apenas como referência interna do modelo, proibido exibir)
   │  e emite a "instrução de estatísticas da pergunta atual"
   ▼
Resposta do modelo (chamadas de ferramentas × N etapas; cada etapa é gravada em
tempo real no banco de usage)
   │
   ▼
Fim da resposta (antes de emitir o resumo final)
   │  O modelo executa token-rate.mjs --turn --current:
   │  delimita, pelo turn_id acionado por esta pergunta, todas as solicitações
   │  da pergunta atual, e calcula a taxa instantânea
   │  (produção total / tempo total de geração pura)
   ▼
Coloca a linha de estatísticas num bloco de citação Markdown, no fim da resposta
```

- **Hook SessionStart**: registra o ID da sessão atual ao iniciar a sessão e injeta uma dica de uso
- **Hook UserPromptSubmit**: disparado uma vez por turno; cada disparo é uma leitura de banco em milissegundos, com custo desprezível; neste momento a pergunta atual ainda não ocorreu, então a taxa do turno anterior injetada serve apenas como contexto do modelo (prefixo `[contexto interno · nao mostrar]`, literal do runtime)
- **Autoteste no fim (`--turn --current`)**: as solicitações de cada etapa da pergunta atual já foram gravadas em tempo real durante a resposta, então a estatística no fim é o dado completo da pergunta atual; a proteção `--current` compara o momento da pergunta no arquivo de estado com os dados da pergunta atual, e quando ainda não há dados gravados (turno de puro perguntas e respostas) a saída fica vazia — **eliminando estruturalmente "exibir o turno anterior"**
- **Hook Stop (experimental)**: o cliente agora dispara o evento Stop, mas o momento é variável (já se observou o disparo durante um turno do usuário); por isso, por padrão, apenas mantém o arquivo de estado e nunca sobrescreve o carimbo de data/hora da pergunta; configure `{"stopHookLine": true}` para ativar experimentalmente a exibição direta ao fim da resposta (no máximo uma vez por turno)
- A taxa de tokens e o TPS de negócio são independentes entre si: a primeira vem sempre de dados reais do ZCode; a segunda depende de `metrics_url` estar configurado

## Perguntas frequentes

**Q: posso usar em outras ferramentas como OpenCode / Codex / Claude Code?**

A: os mecanismos do plugin, os hooks e as fontes de dados são todos vinculados ao ZCode; a função de taxa de tokens é exclusiva do ZCode. O script de coleta de TPS de negócio e o painel são programas independentes, que podem rodar sem o ZCode, mas sem o ZCode não há fonte de dados de taxa.

**Q: a taxa exibida é precisa?**

A: a taxa é calculada a partir dos valores reais acumulados de tokens no banco de usage do ZCode, com base nos tokens do lado de saída do modelo. A estatística cobre todas as etapas de solicitação de "esta pergunta → a chamada de ferramenta mais recente", ponderada por "produção total / tempo total de geração pura" (a espera por ferramentas entre etapas não conta no tempo de geração); o texto do resumo final é gerado após a chamada de ferramenta mais recente e não é contado. Os números exibidos por outras ferramentas podem diferir ligeiramente devido a janelas de estatística diferentes.

**Q: por que respostas de puro perguntas e respostas (sem chamada de ferramentas) não têm linha de estatísticas?**

A: é intencional. O autoteste no fim acontece antes de a resposta terminar, enquanto a única solicitação do modelo num turno de puro perguntas e respostas só é gravada no banco depois que a resposta termina — nesse momento ela ainda não está visível. A proteção `--current`, ao detectar que "ainda não há dados gravados da pergunta atual", não emite nenhuma linha de estatísticas e nunca usa dados do turno anterior como substituto. Para ver as estatísticas mais recentes, execute `/tps` ou abra o painel de monitoramento.

**Q: a linha de taxa desapareceu de repente?**

A: execute `/tps-doctor` para o autodiagnóstico. Causas comuns: versão do Node abaixo de 22.5 (é necessário o `node:sqlite` embutido), mudança na estrutura de tabelas após atualização do ZCode, sessão não reaberta após atualizar o plugin (os hooks precisam de uma nova sessão para se registrar) ou a injeção desativada no arquivo de configuração.

**Q: há suporte a macOS / Linux?**

A: sim. Os hooks, comandos, painel e MCP são todas implementações Node multiplataforma; o caminho do banco de usage é resolvido automaticamente a partir do diretório inicial do usuário (`~/.zcode/cli/db/db.sqlite`), e pode ser sobrescrito pela variável de ambiente `ZCODE_USAGE_DB` em instalações fora do padrão. A barra de tok/s estilo DSH no rodapé do composer funciona no Windows (`overlay.ps1`, WPF) e no Linux X11 (`overlay.py`, GTK3 + `wmctrl`/`xprop`); no macOS, use o painel de monitoramento.

**Q: como desativo os dados de demonstração?**

A: os dados de demonstração afetam apenas a parte de "TPS de negócio" (a taxa de tokens é sempre real); sem `metrics_url` configurado, o modo é de demonstração, e ao configurar ele muda automaticamente para uma fonte de dados reais.

## Licença

[MIT](LICENSE) © 2026 shy3130
