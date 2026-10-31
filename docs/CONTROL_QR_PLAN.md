# QR de autenticação no TireFlow Control

Objetivo: exibir um único QR atual, substituindo-o quando o evento `qr` do WhatsApp
chegar. Apagar ao autenticar, conectar, desconectar, expirar ou perder comunicação.
Não presumir que o WhatsApp sempre renove em exatamente 20 segundos.

## Implementação

- Estado em memória no bot; renderização pela biblioteca já instalada
  `qrcode-terminal`, sem salvar o QR ou colocá-lo nos logs.
- Canal de leitura HTTP exclusivamente em `127.0.0.1`, em porta efêmera, protegido
  por credencial aleatória. Arquivo local ignorado pelo Git contém somente PID,
  porta e credencial desse canal, nunca o QR. O painel confere o PID do serviço.
- O navegador obtém a matriz do QR em endpoint separado, com Origin e token CSRF.
  Não incluir QR em status, logs, arquivos de imagem, armazenamento do navegador
  ou serviços externos. Desenhar em canvas, sem HTML recebido do bot.
- Consultar o QR a cada dois segundos; substituir o canvas inteiro ao trocar a
  revisão. Limite de exibição de 60 segundos, sem reutilizar código expirado.
- Área responsiva dentro do painel; estado de espera quando não houver QR.
  QR fictício somente no laboratório, com identificação permanente de demonstração.

## Verificação

Testar substituição, expiração, limpeza na autenticação/conexão, validação de
matriz, proteção do canal e do endpoint do navegador e ausência de QR em logs.
Conferir a comunicação local e a troca visual com dados sintéticos; não iniciar,
parar ou autenticar uma instância operacional. Rodar typecheck, build e suíte
isolada; revisar e criar apenas commits locais.
