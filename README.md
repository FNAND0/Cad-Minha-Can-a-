# Rio Radar

Dashboard web para simulação de rastreamento fluvial na Amazônia, da região de Manaus até Fonte Boa.

## Executar

1. No Google Cloud Console, habilite **Maps JavaScript API** e crie uma chave restrita ao domínio do projeto.
2. Configure `config.js` com a chave e o WebSocket do bridge, quando disponível.
3. Instale o bridge e inicie o app completo:

```bash
npm install
npm start
```

Acesse `http://localhost:8080`. Para apenas visualizar os arquivos estáticos, `python3 -m http.server 4173` continua disponível.

Para o APRS-IS:

```bash
APRS_IS_HOST=rotate.aprs2.net APRS_IS_CALLSIGN=SEUCALL APRS_IS_PASSCODE=12345 npm start
```

Para AISStream, defina `AISSTREAM_API_KEY` no arquivo `.env` local (copie `.env.example`). A chave não deve ser enviada ao repositório. A área padrão cobre Manaus e o rio próximo; substitua `AISSTREAM_BOUNDING_BOXES` por pares `[[southWestLat,southWestLon],[northEastLat,northEastLon]]`.

O coletor suporta assinaturas geográficas, filtros por MMSI (`AISSTREAM_FILTER_MMSI`) e tipos de mensagem (`AISSTREAM_FILTER_TYPES`). Ele recebe posições, mensagens de classe B, transmissão de longo alcance, dados estáticos do navio e dados de viagem quando disponíveis na assinatura.

- `/health`: estado operacional JSON do HTTP, clientes WebSocket e AISStream.
- `/api/status`: métricas detalhadas sem cache, incluindo tipos de mensagem, MMSIs vistos, mensagens ignoradas e reconexões.
- `/api/vessels`: snapshot JSON da última posição e dos últimos dados estáticos recebidos por MMSI, sem simulação.
- `POST /ingest/ais`: ingestão de posição ou dados estáticos AIS pelo backend.
- `POST /ingest/radio`: ingestão de fontes APRS, LoRa, checkpoints ou rádio em geral.
- `ws://host/ws` ou `wss://host/ws`: entrega normalizada para o painel em tempo real.

Mensagens estáticas podem atualizar nome, indicativo, IMO, tipo, destino, calado e última origem. Mensagens sem latitude não sobrescrevem coordenadas existentes. Por padrão, a assinatura usa `PositionReport`; tipos adicionais devem ser definidos apenas se validados pela sua conta AISStream.

Cada pacote válido recebido via `/ws` é aplicado imediatamente à embarcação correspondente. Posições antigas são descartadas por timestamp, novos destinos são animados por `requestAnimationFrame` sem recriar marcadores e a trilha mantém apenas os últimos 60 pontos por embarcação para limitar memória.

```env
AISSTREAM_API_KEY=SUA_CHAVE_AISSTREAM
AISSTREAM_BOUNDING_BOXES=[[[-4.5,-62.5],[-2.5,-58.5]]]
```

Para AISHub, defina `AISHUB_USERNAME` (e opcionalmente `AISHUB_API_KEY`) antes de iniciar.

POSTs HTTP aceitos:

- `POST /ingest/ais` com `boatId`, `lat`, `lng`, `speed`, `heading`, `source` ou `mmsi`.
- `POST /ingest/radio` com o mesmo formato JSON.

O bridge normaliza as mensagens e transmite por `/ws`.

> `config.js` deve ser preenchido antes do uso com o Google Maps. O modo simulado continua disponível sem servidor de rádio.

## Estrutura

- `index.html`: interface semântica, painel lateral, gaveta mobile e fallback do mapa.
- `style.css`: tema cyber-industrial escuro e layout responsivo.
- `data.js`: FeatureCollection GeoJSON da calha fluvial e das embarcações.
- `app.js`: Google Maps, cache de marcadores, interpolação linear, ruído de GPS e WebSocket opcional.
- `config.js`: chave da Maps JavaScript API e endereço do stream de rádio.
- `server.js`: servidor HTTP/WebSocket, ingestão APRS/AIS/AISHub e filtros geográficos.
- `package.json`: dependências e scripts de execução do bridge Node.js.

## Características técnicas

- Vanilla JS ES6+, HTML5 e CSS modular sem frameworks.
- Marcadores Google reutilizados em memória com `Map` e atualizados por `setPosition()` e `setIcon()`.
- Interpolação da rota com `Lerp`, processamento de distância em quilômetros e ruído gaussiano leve.
- Relógio da telemetria convertido para `America/Manaus` (`UTC-4`) e simulação interrompida ao ocultar a aba para reduzir consumo de CPU e bateria.
- Estilo escuro nativo do Google Maps, sem tiles raster externos adicionais.
- WebSocket opcional para ingestão de pacotes de rádio com reconexão automática.
- Modo híbrido: uma embarcação com telemetria fresca interrompe sua simulação; ao passar o timeout, volta ao movimento local automaticamente.
- Pacotes aceitos podem informar `source` como `radio`, `aprs`, `lora`, `ais`, `checkpoint` ou `satellite`.
- `radioSignalTimeoutMs` e `radioMaxReconnectDelayMs` controlam respectivamente frescor do sinal e limite da reconexão WebSocket.
- Layout desktop em painel lateral; telas menores usam bottom sheet.
