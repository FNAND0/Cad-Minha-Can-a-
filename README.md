# Rio Radar

Dashboard web para simulação de rastreamento fluvial na Amazônia, da região de Manaus até Fonte Boa.

## Executar

1. No Google Cloud Console, habilite **Maps JavaScript API** e crie uma chave restrita ao domínio do projeto.
2. Configure `config.js` com a chave e, opcionalmente, o endereço WebSocket do gateway de rádio.
3. Inicie o servidor e acesse o app:

```bash
python3 -m http.server 4173
```

Acesse `http://localhost:4173`.

> `config.js` deve ser preenchido antes do uso com o Google Maps. O modo simulado continua disponível sem servidor de rádio.

## Estrutura

- `index.html`: interface semântica, painel lateral, gaveta mobile e fallback do mapa.
- `style.css`: tema cyber-industrial escuro e layout responsivo.
- `data.js`: FeatureCollection GeoJSON da calha fluvial e das embarcações.
- `app.js`: Google Maps, cache de marcadores, interpolação linear, ruído de GPS e WebSocket opcional.
- `config.js`: chave da Maps JavaScript API e endereço do stream de rádio.

## Características técnicas

- Vanilla JS ES6+, HTML5 e CSS modular sem frameworks.
- Marcadores Google reutilizados em memória com `Map` e atualizados por `setPosition()` e `setIcon()`.
- Interpolação da rota com `Lerp`, processamento de distância em quilômetros e ruído gaussiano leve.
- Relógio da telemetria convertido para `America/Manaus` (`UTC-4`) e simulação interrompida ao ocultar a aba para reduzir consumo de CPU e bateria.
- Estilo escuro nativo do Google Maps, sem tiles raster externos adicionais.
- WebSocket opcional para ingestão de pacotes de rádio com reconexão automática.
- Layout desktop em painel lateral; telas menores usam bottom sheet.
