# Caudales de diseño por punto · Quito

App web que entrega el área de aportación, morfometría, tiempo de concentración y caudal
de diseño (TR 2-25 años) para cualquier punto del Distrito Metropolitano de Quito.
Complementa al Buscador de SUDS (https://suds-quito.vercel.app). Por Paulina Lima, UCE 2026.

## Cómo funciona
1. `scripts/` contiene el preprocesamiento en ArcGIS Pro (arcpy):
   - `aoi_dmq.py` – AOI del DMQ con 5 km de holgura
   - `descargar_dem.py` – DEM Copernicus GLO-30 (30 m)
   - `hidro_dmq.py` + `hidro_dmq_paso6.py` – Fill, D8, acumulación, red (umbral 0,5 km²),
     subcuencas por tramo, topología aguas abajo, atributos geomorfológicos
   - `uso_suelo_dmq.py` – ESA WorldCover 2021 → CN y C por subcuenca
   Los resultados se simplifican con mapshaper y quedan en `public/data/*.json` (TopoJSON).
2. `src/hidro.js` – motor de cálculo (grafo de subcuencas, cuenca aguas arriba, tc, lluvia IDW
   con las 12 estaciones FONAG, racional / Témez / SCS).
3. `src/CaudalesApp.jsx` – interfaz (Leaflet + React + Tailwind).

## Desarrollo local
```
npm install
npm run dev
```

## Publicar en Vercel
Igual que suds-quito: crear repositorio en GitHub, `git push`, importar en Vercel (framework Vite).

## Actualizar datos
Si se recalcula la red (nuevo DEM, otro umbral, mapa de suelos), reemplazar
`public/data/subcuencas.json` y `public/data/tramos.json` y volver a hacer `git push`.
Las lluvias de las estaciones están en `src/hidro.js` (constante `STATIONS`) y deben
mantenerse iguales a las de `SudsApp.jsx`.
