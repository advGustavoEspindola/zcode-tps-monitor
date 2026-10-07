---
description: Abrir o dashboard de monitoramento de TPS em tempo real (página no navegador, com atualização automática a cada segundo)
---

Inicie o dashboard de monitoramento em tempo real do zcode-tps-monitor e abra-o no navegador.

Etapas de execução:

1. Primeiro verifique se o serviço já está em execução: `curl -s -m 2 http://127.0.0.1:7423/api/metrics`.
2. Se não estiver, inicie-o em segundo plano (sem bloquear a sessão):
   ```
   nohup node "<diretório do plugin>/dashboard/server.mjs" >/dev/null 2>&1 &
   ```
   Diretório do plugin = local de instalação deste plugin (dois níveis acima do base directory do skill); a porta padrão é 7423 e pode ser ajustada com `--port N`.
3. Abra o navegador com o comando do sistema: no Windows, `start http://127.0.0.1:7423`.
4. Informe ao usuário: a página é atualizada automaticamente a cada segundo; o rótulo no topo mostra o modo dos dados; para conectar uma fonte de dados real, configure `metrics_url` em Configurações → Gerenciamento de plugins → zcode-tps-monitor e reinicie o processo do dashboard (ou defina a variável de ambiente TPS_URL para o server.mjs).

Para parar o dashboard: basta encerrar o processo node correspondente.

Solicitação adicional do usuário: $ARGUMENTS
