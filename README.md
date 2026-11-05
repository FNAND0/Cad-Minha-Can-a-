# Cadê Minha Canôa?

Painel real-time de rastreamento fluvial com dados AIS reais.

Painel real-time de telemetria fluvial para a Amazônia. O sistema combina Google Maps, AISStream, APRS-IS, AISHub, ingestão HTTP e WebSocket em um único bridge Node.js.

Este projeto não cria ou reconstrói posições fictícias. Os marcadores aparecem somente com dados reais recebidos por posição AIS/APRS ou por um endpoint de ingestão autorizado.

## Visão Geral

```text
AISStream / APRS-IS / receptor / AISHub
                 |
                 v
       server.js (Node.js bridge)
                 |
     +-----------+-----------+
     |                       |
     v                       v
GET /api/vessels       WebSocket /ws
     |                       |
     +-----------+-----------+
                 |
                 v
      app.js + Google Maps
```

## Recursos

- Exibição exclusiva de posições reais recebidas.
- Caixa geográfica ampla da Amazônia configurável por ambiente.
- Conexão WebSocket AISStream com assinatura, reconexão e compressão.
- Filtros AIS por MMSI e tipos de mensagem.
- Dados estáticos: nome da embarcação, indicativo, IMO, tipo, destino e calado.
- Reconhecimento de `PositionReport`, mensagens Classe B e transmissão AIS de longo alcance.
- Conexão APRS-IS opcional.
- Polling opcional de AISHub.
- Históricos limitados aos últimos 60 pontos por MMSI.
- Snapshot HTTP da última posição e dos dados estáticos.
- Busca por nome, MMSI, indicativo ou destino.
- Atualização suave por `requestAnimationFrame`, sem recriar marcadores.
- Marcação de sinal vencido, sem retorno de movimento fictício.
- Interface desktop lateral e gaveta inferior em telas menores que 768 px.

## Requisitos

- Node.js 18 ou superior.
- npm.
- Navegador moderno.
- Chave Maps JavaScript API do Google Cloud.
- Opcional: chave AISStream e endereço APRS-IS.

## Configuração

### 1. Google Maps

1. No Google Cloud Console, habilite `Maps JavaScript API`.
2. Crie uma chave restrita por domínio HTTP/HTTPS.
3. Configure o navegador em `config.js`:

```js
const RioRadarConfig = Object.freeze({
  googleMapsApiKey: "SUA_CHAVE_GOOGLE_MAPS",
  radioWebSocketUrl: `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`,
  radioReconnectDelayMs: 5000,
  radioSignalTimeoutMs: 60000,
  radioMaxReconnectDelayMs: 30000
});
```

A chave Google Maps é usada pelo navegador. Restrinja-a por domínio e API para reduzir abuso.

### 2. Ambiente do servidor

Copie o exemplo:

```bash
cp .env.example .env
```

Variáveis disponíveis:

```env
PORT=8080
HOST=0.0.0.0

AISSTREAM_API_KEY=SUA_CHAVE_AISSTREAM
AISSTREAM_BOUNDING_BOXES=[[[5.3,-74.0],[-18.0,-44.0]]]
AISSTREAM_FILTER_MMSI=
AISSTREAM_FILTER_TYPES=PositionReport,ShipStaticData

AREA_MIN_LAT=-18.0
AREA_MAX_LAT=5.3
AREA_MIN_LNG=-74.0
AREA_MAX_LNG=-44.0

APRS_IS_HOST=
APRS_IS_PORT=14580
APRS_IS_CALLSIGN=N0CALL
APRS_IS_PASSCODE=-1
APRS_IS_FILTER=r -3.1190 -60.0217 150
APRS_IS_RETRY_MS=10000

AISHUB_USERNAME=
AISHUB_API_KEY=
AISHUB_POLL_MS=15000
```

`AISSTREAM_BOUNDING_BOXES` usa pares `[latitude, longitude]`: primeiro o canto sudoeste e depois o nordeste. `AREA_*` é o filtro adicional aplicado pelo bridge.

Nunca adicione `.env` ao Git. O projeto já possui `.gitignore` para isso.

## Uso local

### Linux ou macOS

```bash
npm install
npm start
```

Acesse:

```text
http://localhost:8080
```

### Windows PowerShell

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Edite `.env` com o Bloco de Notas ou VS Code:

```powershell
notepad .env
```

Depois abra:

```text
http://localhost:8080
```

### GitHub Codespaces

1. Abra a porta `8080` como pública ou privada conforme sua necessidade.
2. Configure `.env` dentro do Codespace.
3. Inicie:

```bash
npm start
```

4. Abra a URL encaminhada pelo Codespace para a porta 8080.

Para o navegador usar HTTPS/WSS, a porta precisa ser publicada com HTTPS; o frontend troca automaticamente entre `ws://` e `wss://`.

### Apenas a interface estática

```bash
python3 -m http.server 4173
```

O painel abrirá em `http://localhost:4173`, mas Google Maps e o stream local de telemetria continuam dependendo da configuração adequada.

### Docker

Crie um arquivo `Dockerfile` opcional:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
CMD ["npm", "start"]
```

Executar:

```bash
docker build -t rio-radar .
docker run --env-file .env -p 8080:8080 rio-radar
```

Não coloque `.env` dentro da imagem final. Passe valores com `--env-file`, secrets ou variáveis do provedor.

### Servidor HTTP publicado com Nginx

O WebSocket exige upgrade de conexão:

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

Use HTTPS no domínio público e configure `radioWebSocketUrl` para que derive automaticamente de `window.location`.

## AISStream

A chave fica somente em `.env`, não em `app.js` ou `index.html`.

Assinatura mínima recomendada:

```env
AISSTREAM_API_KEY=SUA_CHAVE
AISSTREAM_BOUNDING_BOXES=[[[5.3,-74.0],[-18.0,-44.0]]]
AISSTREAM_FILTER_TYPES=PositionReport,ShipStaticData
```

Filtros opcionais:

```env
AISSTREAM_FILTER_MMSI=538007480,636015988,316003701
```

Ao receber `ShipStaticData`, o backend atualiza nome, indicativo, IMO, tipo, destino e calado sem criar uma nova coordenada. Dados estáticos não substituem a última posição real.

Se o AISStream fechar anormalmente, o bridge usa reconexão exponencial com limite configurado. O mapa mantém os últimos dados válidos até receber outro pacote ou expirar pelo timeout.

## APRS-IS

Exemplo:

```bash
APRS_IS_HOST=rotate.aprs2.net \
APRS_IS_PORT=14580 \
APRS_IS_CALLSIGN=SEUCALL \
APRS_IS_PASSCODE=12345 \
APRS_IS_FILTER='r -3.1190 -60.0217 150' \
npm start
```

O passcode APRS não é criptográfico para cadastros públicos; ainda assim, mantenha credenciais privadas fora do Git.

## AISHub

Configure:

```env
AISHUB_USERNAME=SEU_USUARIO
AISHUB_API_KEY=SUA_CHAVE_OPCIONAL
AISHUB_POLL_MS=15000
```

As consultas respeitam `AREA_*`. O intervalo mínimo deve seguir os termos e limites da conta AISHub.

## Endpoints

### Estado do sistema

```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/status
```

`/api/status` inclui conexão AISStream, mensagens recebidas, tipos, MMSIs, posições, dados estáticos, erros ignorados e reconexões.

### Embarcações atuais

```bash
curl http://localhost:8080/api/vessels
```

Retorna o último snapshot por MMSI. Mensagens simuladas não são incluídas.

### Busca

```bash
curl 'http://localhost:8080/api/search?q=Dona%20Lita'
```

Busca por nome AIS, MMSI, indicativo ou destino. Sem correspondência, retorna `matches: []`.

### Ingestão HTTP

```bash
curl -X POST http://localhost:8080/ingest/ais \
  -H 'Content-Type: application/json' \
  -d '{"mmsi":"710006963","lat":-3.16264,"lng":-59.98981,"speed":0,"heading":220,"source":"ais"}'
```

Também aceita `POST /ingest/radio` para APRS, LoRa, checkpoints ou receptores locais.

Pacote mínimo:

```json
{
  "boatId": "710006963",
  "lat": -3.16264,
  "lng": -59.98981,
  "speed": 0,
  "heading": 220,
  "source": "ais",
  "timestamp": 1793859158
}
```

Pacote estático sem coordenada:

```json
{
  "boatId": "710006963",
  "name": "Nome Real do AIS",
  "callSign": "PQ3628",
  "imo": "9990001",
  "shipType": "Passenger",
  "destination": "Manaus",
  "draught": 12.2,
  "staticOnly": true,
  "source": "ais"
}
```

## WebSocket

URL local:

```text
ws://localhost:8080/ws
```

HTTPS requer:

```text
wss://SEU_DOMINIO/ws
```

O bridge envia JSON normalizado:

```json
{
  "boatId": "710006963",
  "lat": -3.16264,
  "lng": -59.98981,
  "speed": 0,
  "heading": 220,
  "source": "ais",
  "quality": "AISStream",
  "timestamp": 1793859158
}
```

A data `timestamp` deve representar o horário da última transmissão. A aplicação descarta posições atrasadas em relação ao último MMSI recebido.

## Estrutura do Projeto

- `index.html`: interface semântica, painel, controles e fallback.
- `style.css`: tema amazônico escuro, telemetria e responsividade.
- `data.js`: rota fluvial e estrutura GeoJSON sem embarcações simuladas.
- `app.js`: Google Maps, cache de marcadores, animação e WebSocket.
- `config.js`: chave Google Maps e parâmetros de telemetria.
- `server.js`: HTTP, WebSocket, AISStream, APRS, AISHub, cache e histórico curto.
- `package.json`: scripts e dependências Node.js.
- `.env.example`: modelo público sem credenciais reais.

## Validação

Verifique todos os módulos:

```bash
npm run check
```

Teste o health check:

```bash
curl http://localhost:8080/health
```

Teste ingestão e recebimento:

```bash
npm run smoke
```

Se essa ferramenta não existir, use um cliente WebSocket em `ws://localhost:8080/ws`, envie `POST /ingest/ais` e confirme o recebimento JSON.

Validações recomendadas:

- O mapa não contém embarcações antes da primeira posição real.
- MMSI repetido atualiza um único marcador.
- Novo MMSI cria uma única entrada.
- Pacote antigo não sobrescreve posição recente.
- Mensagem estática não remove coordenadas existentes.
- MMSI sem posição não recebe marcador no mapa.
- `/api/vessels` não inclui dados fictícios.
- Busca por nome vazio retorna `matches: []` sem gerar fallback falso.

## Segurança

- O `.env` nunca deve ser commitado.
- Rotacione a chave AISStream se ela aparecer em logs, commits ou capturas de tela.
- Restrinja a chave Google Maps por domínio e API.
- Restrinja CORS e acesso POST antes de publicar a API em internet.
- Proteja `/ingest/ais` e `/ingest/radio` com autenticação em produção.
- Use HTTPS/WSS e um proxy reverso para rede pública.
- Não trate ausência de sinal como embarcação parada; registre apenas ausência ou expiração de transmissão.

## Limitações

- AISStream fornece transmissão em tempo real; não garante cobertura offline ou histórico.
- Nem toda embarcação regional usa AIS.
- Dados estáticos podem chegar separadamente da posição.
- `F/B Dona Lita` somente poderá ser localizado por MMSI, nome confirmado por AIS Static Data ou fonte histórica autorizada.
- Fonte ausência no snapshot não significa ausência física da embarcação.
