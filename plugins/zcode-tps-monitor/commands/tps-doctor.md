---
description: Autodiagnóstico do plugin zcode-tps-monitor: banco de dados, dependências e verificação do estado de execução
---

Execute o autodiagnóstico do plugin e relate os resultados ao usuário em português do Brasil.

Etapas de execução:

1. Execute o script de autodiagnóstico (`../../scripts/doctor.mjs` no mesmo diretório deste arquivo de comando):
   ```bash
   node ../../scripts/doctor.mjs
   ```
2. Interprete a saída item por item (✅/❌): versão do Node, banco de dados de uso, arquivo de estado da sessão, arquivo de configuração, processo do dashboard.
3. Para os itens ❌, ofereça sugestões de correção com base na hint fornecida pelo script (comuns: atualizar o Node para ≥22.5, definir ZCODE_USAGE_DB, reinstalar o plugin e reabrir a sessão).
4. Se o usuário quiser desativar a linha de taxa por turno, informe: grave o conteúdo `{"tokenRateLine": false}` em `~/.zcode/tps-monitor.config.json` e reabra a sessão para que a mudança tenha efeito.

Solicitação adicional do usuário: $ARGUMENTS
