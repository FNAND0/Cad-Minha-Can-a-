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
    features: []
  }
});
