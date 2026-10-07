# Changelog

## 0.8.7 — 2026-10-07

### Tradução completa para português (pt-BR)
- **Documentação inteira em pt-BR**: README raiz, README do plugin, CHANGELOG (todas as seções históricas), SKILL.md e os três comandos (`/tps`, `/tps-doctor`, `/dashboard`) traduzidos por completo. As marcações citadas nos documentos passam a referir exatamente os literais emitidos pelos hooks: `[estatistica deste turno]` e `[contexto interno · nao mostrar]`.
- **Código comentado em pt-BR**: comentários de hooks, scripts, painel, servidor MCP, gerador de ícone e testes.
- **Saídas de usuário em pt-BR**: relatório do `/tps-doctor` e da coleta (`scripts/collect.mjs`, `scripts/lib/collect-core.mjs`), rótulos do painel web (`dashboard/index.html`) e as descrições das ferramentas MCP (`tps_snapshot`/`tps_watch` — nomes das ferramentas mantidos).
- **Manifestos e catálogo em pt-BR**: descrições de `.zcode-plugin/plugin.json` e `.claude-plugin/plugin.json`, `userConfig`, `marketplace.json` e o campo `description` de `hooks.json`; keywords traduzidas para o português.
- **LICENSE**: o texto oficial do MIT permanece em inglês (instrumento legal); foi acrescentada ao arquivo uma tradução de referência em pt-BR, marcada como não oficial.

### Mantido inalterado
- Identificadores de código, nomes de colunas SQL (`turn_id`, `promptTs`, `main_turn`), flags de CLI, chaves de configuração (`tokenRateLine`, `stopHookLine`, `metrics_url`), nomes de eventos de hook e as strings de saída da linha de taxa (assertadas byte a byte pelos testes). Testes seguem 14/14 verdes.

## 0.8.6 — 2026-10-07

### Fusão: linha de runtime pt-BR (instalada localmente como 0.8.3) incorporada à linha principal
O que estava realmente em uso do lado do usuário era uma linha local de melhorias baseada em 0.8.2 (textos de interface todos em pt-BR, reescrita da barra de tok/s na área de trabalho, autossuficiência de UI da sessão, estatísticas de sessão aprimoradas), cujo número de versão foi localmente marcado como 0.8.3 — conteúdo diferente do 0.8.3 deste repositório. Esta versão incorpora essa linha à linha principal 0.8.5, mantendo todas as alterações de ambos os lados, sem reverter nada.

### Adicionado
- **Textos de runtime em pt-BR**: o aviso do SessionStart, a UserPromptSubmit [instrução de estatísticas da pergunta atual], os textos de status dos hooks e a saída da linha de taxa (formatLine/formatTurnLine/detalhes do CLI de `token-rate.mjs`) foram todos alterados para português (pt-BR); a instrução mantém a ordem estrita anticollapse e as regras de degradação da 0.8.4, e a semântica da proteção `promptTs` da 0.8.5; a linha injetada do turno anterior passou a usar o prefixo `[contexto interno · nao mostrar]`.
- **Reescrita da barra de tok/s na área de trabalho (`dashboard/overlay.ps1`, estilo DSH)**: passou a ser uma StatsLine colada na parte inferior do composer do ZCode (texto cinza, sem fundo, instância única com mutex, segue a janela principal), substituindo a antiga barra flutuante transparente (apenas Windows).
- **Autossuficiência de sessão em `hooks/ensure-ui.mjs`**: após o SessionStart, sobe em segundo plano o painel em `:7423` e a barra de tok/s na área de trabalho (inicia apenas se ausente; em caso de falha, silencia e não bloqueia o hook).
- **Campos aprimorados de estatísticas da sessão**: `turns` (COUNT DISTINCT turn_id), `avgTtftMs`, `totalGenMs`, `tokPerSec` (produção total / tempo total de geração, consistente com o critério deste turno); em bancos antigos sem `turn_id`, degradação elegante por detecção de coluna (projeção de detecção via PRAGMA, sem mais falhar a consulta inteira).

### Alterado
- Rótulos da linha de taxa (formato de saída atual): `⚡ … tok/s (este turno)` / `(turno anterior)`, `TTFT …s`, `saida … tok / geracao …s`, `N etapas / pico …`, `acumulado … tok`, `med. N avg / pico max`; a tabela de métricas do README foi sincronizada em conformidade.
- `.zcode-plugin/plugin.json` declara explicitamente `hooks` / `mcpServers`; `userConfig.metrics_url` ganhou `default: ""`.
- Testes: as asserções de texto da linha foram atualizadas para pt-BR, com novas asserções de `turns` / `avgTtftMs`; 14 testes todos verdes (`node --test test/token-rate.test.mjs`).
- Observação: a captura de efeito (`docs/effect-token-rate.png`) ainda foi gerada na época dos rótulos em chinês, servindo apenas como ilustração; os rótulos de texto válidos são os deste documento e da tabela de métricas do README.

## 0.8.5 — 2026-10-04

### Correção: o disparo do hook Stop fazia a "estatística da pergunta atual" desaparecer
- **Descoberta em teste real**: o cliente passou a disparar o evento Stop (versões anteriores nunca disparavam), e **o momento é variável** — já se observou o disparo durante um turno do usuário. O antigo stop.mjs reescrevia, a cada disparo, o carimbo de data/hora do arquivo de estado com o momento atual; a proteção `--current` concluía erradamente que "todos os dados da pergunta atual são anteriores ao momento da pergunta", e a linha de estatísticas desaparecia do nada (reproduzido e localizado hoje em uma sessão real).
- **Campo promptTs**: os hooks prompt-submit / session-start gravam `promptTs` (momento da pergunta); ao atualizar `ts`, o hook Stop **preserva promptTs**; a proteção considera apenas `promptTs`. Independentemente de quem sobrescreva o arquivo de estado, a decisão da proteção não é mais afetada.
- **A exibição direta do Stop passou a ser desativada por padrão (opcional, experimental)**: como o momento do disparo é variável, a exibição direta pode ser cedo demais ou se repetir; `{"stopHookLine": true}` pode ativá-la, com deduplicação por turnId e no máximo uma exibição por turno. A 0.8.3 chegou a marcar essa chave como obsoleta; agora ela foi redefinida como um interruptor experimental.
- Novo teste de regressão: após o arquivo de estado ser atualizado pelo Stop, a proteção ainda se baseia em promptTs.
- doctor / READMEs sincronizados com a nova semântica.

## 0.8.4 — 2026-09-25

### Correção: o corpo da resposta era recolhido, sobrando apenas uma linha de estatísticas
- **Sintoma**: após ativar o plugin, o corpo de muitas respostas era recolhido pelo cliente para uma área oculta, e a única coisa visível era a última linha `> ⚡ … tok/s(este turno)`.
- **Causa raiz** (localizada tanto no banco de dados da sessão quanto no código do cliente): o cliente recolhia mensagens com chamadas de ferramentas para a área de "trajetória do modelo", deixando expandida por padrão apenas a última mensagem de texto puro do turno. A antiga instrução dizia apenas "execute o script antes de emitir o resumo final", mas o modelo frequentemente executava como "escrever o corpo → depois rodar o script de estatísticas → enviar uma linha de estatísticas separada" — o corpo era rebaixado para a área recolhida, e a linha de estatísticas solitária virava o único conteúdo visível.
- **A instrução passou a ser uma ordem estrita anticollapse**: ① primeiro execute o script, ② depois emita o corpo completo da resposta, com a linha de estatísticas anexada no fim dessa mesma resposta; é proibido explicitamente enviar a linha de estatísticas como mensagem separada e chamar qualquer ferramenta depois de escrever o corpo, com a explicação do motivo.
- **Regra de degradação**: percebeu que não rodou o script depois de já ter escrito o corpo → simplesmente omita a linha de estatísticas e encerre a resposta, nunca chame ferramentas retroativamente.
- O aviso do SessionStart e as normas de exibição do SKILL.md foram sincronizados com essa regra.

### Outros
- Completadas as tags de versão ausentes (v0.6.0, v0.6.1, v0.8.0~v0.8.4), com correspondência um-a-um entre tags e números de versão do plugin.

## 0.8.3 — 2026-09-25

### Correção: todos os documentos e instruções alinhados ao mecanismo de "autoteste no fim" (divergência de critério herdada da 0.8.2)
- **Mensagem de boas-vindas do SessionStart reescrita**: o texto antigo afirmava que "a taxa do turno é exibida automaticamente pelo hook Stop, sem necessidade de repasse" — a versão atual do cliente não dispara o hook Stop, e essa afirmação enganava o modelo, que não fazia nada ao final em cada início de sessão. O novo texto é totalmente consistente com a "instrução de estatísticas da pergunta atual" do prompt-submit.
- **Correção das normas de exibição do SKILL.md**: removido o requisito antigo de "anexar a linha de métricas 📊 injetada como está" (que fazia o modelo colar a linha "(turno anterior)" na resposta), substituído por autoteste no fim conforme a [instrução de estatísticas do turno], e a linha [contexto interno] nunca é exibida.
- **Os dois READMEs e a descrição do manifesto do plugin reescritos**: o fluxograma de como funciona, a prévia do efeito, os recursos, a tabela de uso e o FAQ foram todos ajustados ao mecanismo real; o hook Stop é claramente marcado como "mantido por compatibilidade, não disparado pelo cliente atual". A captura de efeito foi regerada no formato de saída atual.

### Adicionado
- **Cartão em tempo real da "pergunta mais recente (atual)" no painel de monitoramento**: o banco usage grava cada etapa por turn em tempo real, o painel faz polling a cada segundo, e é possível ver a taxa, o número de etapas e o volume de saída da pergunta atual subindo enquanto a pergunta está em andamento (`/api/token-rate` ganhou o campo `turn`).
- Fallback de resolução de sessão: quando a sessão não é especificada explicitamente, usa-se primeiro a "sessão em que o usuário estava por último" no arquivo de estado (acompanha ao trocar de sessão), recorrendo depois à solicitação concluída mais recente no geral; a variável de ambiente `TPS_MONITOR_STATE_FILE` pode sobrescrever o caminho do arquivo de estado (múltiplas instâncias/testes).
- Novas verificações no `/tps-doctor`: quando ao arquivo de estado falta o carimbo de data/hora da pergunta, avisa que "a proteção `--current` não está disponível"; quando a configuração contém a obsoleta `stopHookLine`, sugere removê-la.

### Alterado
- A linha injetada da taxa do turno anterior ganhou o prefixo [contexto interno · não mostrar], eliminando pela própria redação a possibilidade de o modelo exibi-la por engano.
- A chave de configuração `stopHookLine` foi descontinuada (sem efeito prático desde a 0.8.2) e removida da documentação; `tokenRateLine` continua sendo o único interruptor geral.

### Testes
- Completados os testes da proteção `--current` (o recurso carro-chefe da 0.8.2 não tinha testes): momento da pergunta posterior a todos os dados da pergunta atual → não retorna a pergunta atual; já havendo dados da pergunta atual → retorna normalmente; sem sessão explícita, prioriza o arquivo de estado. Os carimbos de data/hora dos fixtures foram alterados para milissegundos reais de época, na mesma dimensão da proteção.

## 0.8.2 — 2026-09-12

### Correção: cada resposta exibe a estatística da "pergunta atual", sem mais "turno anterior"
- **Instrução de estatísticas da pergunta atual**: a injeção do UserPromptSubmit ganhou uma nova instrução — o modelo executa `token-rate.mjs --turn --current` ao final da resposta e cita a linha de saída como está no fim da resposta. Ela calcula a taxa real **desta pergunta**, desde a sua formulação até a chamada de ferramenta mais recente (o banco usage grava cada etapa por turn em tempo real).
- **Proteção `--current`**: se todos os dados do turn mais recente forem anteriores ao momento desta pergunta (turno de puro perguntas e respostas ainda sem dados da pergunta atual), o script não emite nenhuma linha de estatísticas — **em hipótese alguma exibe dados do turno anterior como se fossem da pergunta atual**, e proíbe explicitamente o modelo de citar a linha de contexto "(turno anterior)".
- A linha injetada "(turno anterior)" foi rebaixada a contexto puro do modelo, marcada como proibida de citação.
- Observação: a estatística cobre até a chamada de ferramenta mais recente; o texto do resumo final é gerado depois e não é contado. Respostas de puro perguntas e respostas (sem chamada de ferramentas) não têm dados confiáveis da "pergunta atual", e a proteção não exibe a linha de estatísticas.

## 0.8.1 — 2026-09-12

### Adicionado
- **Ícone do plugin**: adicionado `assets/icon.png` (256×256, velocímetro + barra de vazão; pode ser regerado com `node assets/generate-icon.mjs`), e declarado o campo `icon` para o plugin no manifesto do marketplace — a lista "Descobrir / Instalados" do cliente passa a exibir o ícone do plugin.
- O README do repositório exibe o ícone no topo.

## 0.8.0 — 2026-09-12

### Adicionado
- **Taxa instantânea do turno (hook Stop)**: adicionado `hooks/stop.mjs` e registrado o evento `Stop`. No instante em que a resposta termina e todas as solicitações do turno já foram gravadas, delimita-se o turno pelo `turn_id` mais recente (incluindo várias etapas "modelo→ferramenta→modelo"), calcula-se a taxa instantânea ponderada por "produção total / tempo total de geração pura", exibida diretamente pelo cliente via `systemMessage` — sem depender mais do repasse pelo modelo, eliminando o atraso de "estatística concluída na resposta, mas referente ao turno anterior".
- `token-rate.mjs` ganhou `queryTurn` / `formatTurnLine` e a CLI `--turn`; turnos de várias etapas exibem "N etapas / pico".

### Alterado
- Por padrão, o `prompt-submit` não anexa mais a instrução de "repasse da linha de taxa no fim da resposta"; a taxa do turno anterior injetada serve apenas como contexto do modelo; a nova configuração `{"stopHookLine": false}` desativa o comportamento do Stop e restaura por completo o antigo comportamento de repasse pelo modelo da v0.7.x.
- O aviso do SessionStart diferencia os dois modos de exibição, antigo e novo.

### Compatibilidade
- Quando o banco usage de clientes antigos não tem a coluna `turn_id`, a consulta do turno degrada elegantemente (sem lançar erro, recuando para o critério de etapa única).

## 0.7.1 — 2026-09-04

### Alterado
- Regras de exibição de números padronizadas: em cada turno, "saída" usa número exato com separador de milhar (`2,762 tok`); a unidade compacta de "acumulado" ganhou a faixa M — abaixo de mil, valor bruto; de 1k a 10 mil, uma casa decimal (`9.8k`); de 10 mil a 1 milhão, arredondado (`51k`); ≥1 milhão, uma casa decimal (`73.8M`), corrigindo o problema de exibir números na casa dos milhões como `73818k`.
- Todas as linhas de detalhe do CLI passaram a usar número exato com separador de milhar (saída/entrada/leitura de cache/número de solicitações).
- O cartão "saída do turno anterior" e as informações flutuantes do painel de monitoramento sincronizados com o separador de milhar.
- Novos testes unitários de conversão `fmtCompact` / `fmtNum` (7 no total).

## 0.7.0 — 2026-08-30

### Corrigido
- **Grave**: o hook prompt-submit perdia a linha de taxa já calculada (`line` era calculada, mas não concatenada em additionalContext); plugins instalados desde a v0.6.1 não exibiam a linha de taxa. Corrigido na 0.7.0.
- O caminho do banco usage não é mais fixado para uma máquina específica; é resolvido a partir do diretório inicial do usuário (Windows/macOS/Linux) e pode ser sobrescrito por `ZCODE_USAGE_DB`.

### Alterado
- O numerador da taxa passou a incluir tokens de pensamento (`reasoning_tokens`; quando o ZCode não registra, é 0, e o comportamento não muda). A linha injetada exibe "(+N pensamento)" quando há tokens de pensamento.
- A linha de taxa passou a ser explicitamente marcada como "(turno anterior)" — a linha é amostrada no instante do envio da mensagem e descreve a última resposta concluída.
- A linha injetada ganhou "acumulado da sessão N tok"; o modo legível por humanos de `token-rate.mjs` passou a acrescentar detalhes de entrada/leitura de cache/número de solicitações (o acumulado usa um SUM SQL independente, sem limite de janela de exibição).
- A validação de amostra útil passou a ser configurável: `TOKEN_RATE_MIN_MS` (padrão 200) e `TOKEN_RATE_MAX_MS` (padrão 1 hora, antes fixo em 10 minutos).

### Adicionado
- Comando de autodiagnóstico `/tps-doctor` (`scripts/doctor.mjs`): verifica a versão do Node, o banco usage e a estrutura de tabelas, o horário da amostra mais recente, o arquivo de estado da sessão, o arquivo de configuração e o processo do painel; suporta `--json`, com código de saída 1 em caso de falha.
- Interruptor de injeção: escreva `{"tokenRateLine": false}` em `~/.zcode/tps-monitor.config.json` para desativar a injeção da linha de taxa a cada turno.
- Ciclo de vida do painel: saída automática por ociosidade com `--idle-exit` (padrão 180 minutos); trata SIGINT/SIGTERM; grava um arquivo de PID (`~/.zcode/tps-monitor.dashboard.pid`) para o doctor detectar e sugerir o comando de parada.
- Testes unitários (`node --test`, com fixtures de banco temporário) e CI no GitHub Actions (Node 22/24 × Ubuntu/Windows/macOS).
- O número de versão do servidor MCP é lido automaticamente do plugin.json, sem mais se desvincular da versão do plugin; este arquivo (CHANGELOG).

### Limpeza
- O CLI e os hooks não emitem mais o ruído ExperimentalWarning do `node:sqlite` no stderr.

## 0.6.1 — 2026-08-30
- Plugin renomeado de tps-monitor → zcode-tps-monitor, deixando explícita a posição de exclusividade para ZCode; o diretório de skills renomeado em conformidade.

## 0.6.0 — 2026-08-30
- Primeira versão pública: injeção da taxa real de tokens a cada turno, comando /tps, ferramentas MCP, painel em tempo real e TPS de negócio (demo/remote).
