/* Dados simulados locais. Fonte: malha de referência aproximada para prototipagem GIS. */
"use strict";

const RioTelemetryData = Object.freeze({
  route: {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      id: "rio-solimoes-amazonas",
      properties: {
        nome: "Rio Solimões / Amazonas",
        origem: "Manaus",
        destino: "Fonte Boa",
        navegavel: true
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-60.021731, -3.119027], // Manaus
          [-60.187000, -3.202000], // Iranduba
          [-60.620000, -3.290000], // Manacapuru
          [-61.400000, -3.650000], // Anamã
          [-61.650000, -3.640000], // Anori
          [-62.110000, -3.838000], // Codajás
          [-63.140000, -4.084000], // Coari
          [-66.166000, -2.513000]  // Fonte Boa
        ]
      }
    }]
  },
  vessels: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-60.430000, -3.210000] },
        properties: {
          id: "FB-DONALITA-01", nome: "F/B Dona Lita", tipo: "Ferry Boat",
          velocidade_nos: 11.5, rumo_graus: 245, status: "em_navegacao",
          proxima_parada: "Manacapuru", bateria_rastreador: 94
        }
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-61.220000, -3.560000] },
        properties: {
          id: "RV-ARAPAIAMA-02", nome: "R/V Arapaima", tipo: "Carga Regional",
          velocidade_nos: 8.2, rumo_graus: 268, status: "em_navegacao",
          proxima_parada: "Anamã", bateria_rastreador: 87
        }
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-61.790000, -3.720000] },
        properties: {
          id: "FB-ESTRELA-03", nome: "F/B Estrela do Sol", tipo: "Ferry Boat",
          velocidade_nos: 0, rumo_graus: 92, status: "atracado",
          proxima_parada: "Anori", bateria_rastreador: 71
        }
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-62.420000, -3.890000] },
        properties: {
          id: "CV-TURARA-04", nome: "C/V Tuiuiu Azul", tipo: "Carga Viva",
          velocidade_nos: 14.8, rumo_graus: 287, status: "em_navegacao",
          proxima_parada: "Codajás", bateria_rastreador: 63
        }
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-63.740000, -3.970000] },
        properties: {
          id: "RV-JACI-05", nome: "R/V Jaci", tipo: "Passageiros",
          velocidade_nos: 0, rumo_graus: 180, status: "falha_sinal",
          proxima_parada: "Coari", bateria_rastreador: 18
        }
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-64.860000, -3.420000] },
        properties: {
          id: "CB-BOTO-06", nome: "C/B Boto Branco", tipo: "Cargueiro",
          velocidade_nos: 9.7, rumo_graus: 295, status: "em_navegacao",
          proxima_parada: "Fonte Boa", bateria_rastreador: 82
        }
      }
    ]
  }
});
