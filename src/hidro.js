// ---------------------------------------------------------------------------
// Motor hidrológico · Caudales de diseño por punto · DMQ
// Paulina Lima · UCE 2026
//
// Insumos (precalculados en ArcGIS Pro, ver /scripts):
//   subcuencas.json  TopoJSON, 6.148 subcuencas (una por tramo de río),
//                    con topología aguas abajo (id_abajo) y atributos:
//                    area_km2, long_m, orden, z_min/max/med, pend_pct,
//                    z_ini_cauce, z_fin_cauce, s_cauce, cn, c_rac, f_*.
//   tramos.json      TopoJSON, red de drenaje (LineString por tramo).
//
// DEM: Copernicus GLO-30 (30 m) · Uso de suelo: ESA WorldCover 2021 (10 m)
// Umbral de cauce: 0,5 km² · Lluvia: 12 estaciones FONAG 2020-2026 (Gumbel, 2 h)
// ---------------------------------------------------------------------------

import { feature } from "topojson-client";

// ---------------------------------------------------------------------------
// Estaciones FONAG (copiadas de SudsApp.jsx para mantener coherencia entre apps)
// tr*_mm: lluvia de 2 h para el período de retorno (Gumbel a máximos anuales móviles)
// ---------------------------------------------------------------------------
export const STATIONS = [
  { id: "rumihurco",      name: "Rumihurco - Machángara", code: "P03", lat: -0.130678, lon: -78.526703, tr2_mm: 33.5, tr5_mm: 38.3, tr10_mm: 41.5, tr25_mm: 45.5 },
  { id: "rumipamba",      name: "Rumipamba (Bodegas)",    code: "P08", lat: -0.180912, lon: -78.509943, tr2_mm: 36.5, tr5_mm: 42.2, tr10_mm: 46.0, tr25_mm: 50.8 },
  { id: "inaquito",       name: "Iñaquito (INAMHI)",      code: "P09", lat: -0.178354, lon: -78.487680, tr2_mm: 30.8, tr5_mm: 36.0, tr10_mm: 39.5, tr25_mm: 43.8 },
  { id: "cumbaya",        name: "Cumbayá",                code: "P13", lat: -0.213443, lon: -78.429960, tr2_mm: 37.4, tr5_mm: 42.7, tr10_mm: 46.2, tr25_mm: 50.7 },
  { id: "izobamba",       name: "Izobamba",               code: "P16", lat: -0.365945, lon: -78.555140, tr2_mm: 35.9, tr5_mm: 44.2, tr10_mm: 49.7, tr25_mm: 56.7 },
  { id: "chillogallo",    name: "Chillogallo",            code: "P22", lat: -0.278181, lon: -78.585716, tr2_mm: 29.4, tr5_mm: 41.2, tr10_mm: 49.1, tr25_mm: 59.0 },
  { id: "atacazo",        name: "Atacazo",                code: "P23", lat: -0.318317, lon: -78.601764, tr2_mm: 26.4, tr5_mm: 31.9, tr10_mm: 35.5, tr25_mm: 40.1 },
  { id: "san_francisco",  name: "San Francisco",          code: "P27", lat: -0.202191, lon: -78.539685, tr2_mm: 33.7, tr5_mm: 39.0, tr10_mm: 42.5, tr25_mm: 46.9 },
  { id: "tanque_solanda", name: "Tanque - Solanda",       code: "P56", lat: -0.281734, lon: -78.530740, tr2_mm: 30.1, tr5_mm: 35.7, tr10_mm: 39.4, tr25_mm: 44.1 },
  { id: "cc_el_bosque",   name: "CC El Bosque",           code: "P70", lat: -0.161691, lon: -78.497363, tr2_mm: 25.9, tr5_mm: 28.0, tr10_mm: 29.5, tr25_mm: 31.3 },
  { id: "collaloma_medio",name: "Collaloma Medio",        code: "P71", lat: -0.122609, lon: -78.473210, tr2_mm: 30.0, tr5_mm: 34.2, tr10_mm: 36.9, tr25_mm: 40.4 },
  { id: "colinas_alto",   name: "Colinas del Alto",       code: "P72", lat: -0.102834, lon: -78.523052, tr2_mm: 30.8, tr5_mm: 39.7, tr10_mm: 45.6, tr25_mm: 53.1 },
];

export const TR_OPTIONS = [
  { key: "tr2",  T: 2,  label: "TR 2 años",  uso: "Alcantarillado domiciliario" },
  { key: "tr5",  T: 5,  label: "TR 5 años",  uso: "Alcantarillado secundario" },
  { key: "tr10", T: 10, label: "TR 10 años", uso: "Colectores principales" },
  { key: "tr25", T: 25, label: "TR 25 años", uso: "Infraestructura mayor y puentes" },
];

// Parámetros editables desde la vista técnica
export const DEFAULTS = {
  n_idf: 0.65,          // exponente IDF tipo Sherman i(t) = i_2h·(120/t)^n
  tc_min_min: 10,       // tc mínimo (min) para no extrapolar la IDF a durationes irreales
  lim_racional_km2: 2.5,
  lim_racional_ext_km2: 10,
  metodo_tc: "auto",    // "kirpich" | "temez" | "auto" (Kirpich ≤ 10 km², Témez > 10 km²)
};

// ---------------------------------------------------------------------------
// Carga y grafo
// ---------------------------------------------------------------------------
export async function loadData(base = "/data") {
  const [sTopo, tTopo] = await Promise.all([
    fetch(`${base}/subcuencas.json`).then((r) => r.json()),
    fetch(`${base}/tramos.json`).then((r) => r.json()),
  ]);
  const subcuencas = feature(sTopo, sTopo.objects.subcuencas).features;
  const tramos = feature(tTopo, tTopo.objects.tramos).features;
  return buildGraph(subcuencas, tramos, sTopo);
}

// Longitud (m) de cada arco de la topología, decodificando la cuantización.
// El contorno se generaliza con cuerdas de PASO_PERIM m para no contar el
// zigzag de las celdas de 30 m del DEM (equivale a medir sobre una carta 1:25.000).
const PASO_PERIM = 100;
function arcLengths(topo) {
  const { scale, translate } = topo.transform;
  return topo.arcs.map((arc) => {
    let x = 0, y = 0, len = 0, acc = 0, ax = null, ay = null, px = null, py = null;
    for (const [dx, dy] of arc) {
      x += dx; y += dy;
      const lon = x * scale[0] + translate[0], lat = y * scale[1] + translate[1];
      if (ax === null) { ax = lon; ay = lat; }
      else {
        acc += haversineKm(py, px, lat, lon) * 1000;
        if (acc >= PASO_PERIM) { len += haversineKm(ay, ax, lat, lon) * 1000; ax = lon; ay = lat; acc = 0; }
      }
      px = lon; py = lat;
    }
    if (ax !== null && px !== null) len += haversineKm(ay, ax, py, px) * 1000;
    return len;
  });
}
function arcsOfGeometry(g) {
  const out = [];
  const walk = (a) => { for (const x of a) Array.isArray(x) ? walk(x) : out.push(x < 0 ? ~x : x); };
  if (g.arcs) walk(g.arcs);
  return out;
}

export function buildGraph(subcuencas, tramos, topo = null) {
  const byId = new Map();
  const children = new Map();
  for (const f of subcuencas) {
    const p = f.properties;
    f.bbox = bboxOf(f.geometry);
    byId.set(p.id_tramo, f);
    if (!children.has(p.id_tramo)) children.set(p.id_tramo, []);
  }
  for (const f of subcuencas) {
    const p = f.properties;
    if (p.id_abajo != null && p.id_abajo >= 0 && byId.has(p.id_abajo)) {
      children.get(p.id_abajo).push(p.id_tramo);
    }
  }
  const tramoById = new Map(tramos.map((t) => [t.properties.id_tramo, t]));
  let arcLen = null, arcsById = null;
  if (topo) {
    arcLen = arcLengths(topo);
    arcsById = new Map(topo.objects.subcuencas.geometries.map((g) => [g.properties.id_tramo, arcsOfGeometry(g)]));
  }
  return { subcuencas, tramos, byId, children, tramoById, arcLen, arcsById };
}

// Perímetro (m) de la unión de un conjunto de subcuencas: arcos usados una sola vez
export function perimetro(graph, ids) {
  if (!graph.arcLen) return null;
  const count = new Map();
  for (const id of ids) for (const a of graph.arcsById.get(id) || []) count.set(a, (count.get(a) || 0) + 1);
  let P = 0;
  for (const [a, c] of count) if (c === 1) P += graph.arcLen[a];
  return P;
}

function bboxOf(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

// ---------------------------------------------------------------------------
// Localizar la subcuenca que contiene un punto (lon, lat)
// ---------------------------------------------------------------------------
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInPolygon(x, y, coords) {
  if (!pointInRing(x, y, coords[0])) return false;
  for (let k = 1; k < coords.length; k++) if (pointInRing(x, y, coords[k])) return false;
  return true;
}
export function findSubcuenca(graph, lon, lat) {
  for (const f of graph.subcuencas) {
    const [a, b, c, d] = f.bbox;
    if (lon < a || lon > c || lat < b || lat > d) continue;
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of polys) if (pointInPolygon(lon, lat, poly)) return f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cuenca aguas arriba y morfometría
// ---------------------------------------------------------------------------
export function delinear(graph, idSalida) {
  const ids = [];
  const stack = [idSalida];
  const seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id); ids.push(id);
    for (const c of graph.children.get(id) || []) stack.push(c);
  }

  // Agregados ponderados por área
  let area = 0, sumPend = 0, sumCn = 0, sumC = 0, zMax = -Infinity, zMinTerr = Infinity;
  let fUrb = 0, fVeg = 0, fCul = 0, fDes = 0, fAgua = 0;
  for (const id of ids) {
    const p = graph.byId.get(id).properties;
    const a = p.area_km2 || 0;
    area += a;
    sumPend += (p.pend_pct || 0) * a;
    sumCn += (p.cn || 0) * a;
    sumC += (p.c_rac || 0) * a;
    fUrb += (p.f_urbano || 0) * a; fVeg += (p.f_vegetacion || 0) * a;
    fCul += (p.f_cultivo || 0) * a; fDes += (p.f_desnudo || 0) * a; fAgua += (p.f_agua || 0) * a;
    if (p.z_max != null && p.z_max > zMax) zMax = p.z_max;
    if (p.z_min != null && p.z_min < zMinTerr) zMinTerr = p.z_min;
  }

  // Cauce principal: camino más largo aguas arriba desde la salida (por longitud)
  const memo = new Map();
  const longest = (id) => {
    if (memo.has(id)) return memo.get(id);
    const p = graph.byId.get(id).properties;
    let best = { L: 0, zTop: p.z_ini_cauce, path: [] };
    for (const c of graph.children.get(id) || []) {
      const r = longest(c);
      if (r.L > best.L) best = r;
    }
    const res = { L: (p.long_m || 0) + best.L, zTop: best.path.length ? best.zTop : p.z_ini_cauce, path: [id, ...best.path] };
    memo.set(id, res);
    return res;
  };
  const cp = longest(idSalida);
  const salida = graph.byId.get(idSalida).properties;
  const zSalida = salida.z_fin_cauce ?? zMinTerr;
  const L = Math.max(cp.L, 30);
  const desnivel = Math.max((cp.zTop ?? zMax) - zSalida, 1);
  const S = desnivel / L;

  // Índices de forma y drenaje
  let Ltotal = 0, ordenMax = 0, zSum = 0;
  for (const id of ids) {
    const p = graph.byId.get(id).properties;
    Ltotal += p.long_m || 0;
    if ((p.orden || 0) > ordenMax) ordenMax = p.orden;
    zSum += (p.z_med || 0) * (p.area_km2 || 0);
  }
  const P_m = perimetro(graph, ids);
  const Kc = P_m ? (0.28 * P_m) / Math.sqrt(area * 1e6) : null;      // Gravelius
  const Kf = area / Math.pow(L / 1000, 2);                            // Horton
  const Re = (1.128 * Math.sqrt(area)) / (L / 1000);                  // Schumm
  const Dd = Ltotal / 1000 / area;                                    // km/km²

  return {
    idSalida, ids, n: ids.length,
    area_km2: area,
    pend_pct: area ? sumPend / area : 0,
    cn: area ? sumCn / area : 0,
    c_rac: area ? sumC / area : 0,
    uso: area ? { urbano: fUrb / area, vegetacion: fVeg / area, cultivo: fCul / area, desnudo: fDes / area, agua: fAgua / area } : null,
    z_max: zMax, z_salida: zSalida, z_top_cauce: cp.zTop,
    L_m: L, desnivel_m: desnivel, S_cauce: S,
    z_med: area ? zSum / area : null,
    perimetro_m: P_m, Kc, Kf, Re, Dd, L_total_m: Ltotal, orden_max: ordenMax,
    relieve_m: zMax - zMinTerr,
    cauce_ids: cp.path,
    orden: salida.orden,
  };
}

// ---------------------------------------------------------------------------
// Tiempo de concentración
// ---------------------------------------------------------------------------
export function tiempoConcentracion(c, opts = DEFAULTS) {
  const Lm = c.L_m, S = Math.max(c.S_cauce, 0.001);
  const kirpich = 0.0195 * Math.pow(Lm, 0.77) * Math.pow(S, -0.385);           // min
  const temez = 0.3 * Math.pow((Lm / 1000) / Math.pow(S, 0.25), 0.76) * 60;   // min
  let metodo = opts.metodo_tc;
  if (metodo === "auto") metodo = c.area_km2 <= opts.lim_racional_ext_km2 ? "kirpich" : "temez";
  const tc = Math.max(metodo === "kirpich" ? kirpich : temez, opts.tc_min_min);
  return { kirpich, temez, tc_min: tc, metodo };
}

// ---------------------------------------------------------------------------
// Lluvia: IDW sobre las 4 estaciones más cercanas (igual que SudsApp)
// ---------------------------------------------------------------------------
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export function lluviaEnPunto(lat, lon, k = 4, power = 2) {
  const cerca = STATIONS.map((s) => ({ ...s, d: haversineKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.d - b.d).slice(0, k);
  const out = { estaciones: cerca.map((s) => ({ id: s.id, name: s.name, code: s.code, distanceKm: s.d })) };
  for (const tr of TR_OPTIONS) {
    const f = `${tr.key}_mm`;
    if (cerca[0].d < 0.5) { out[f] = cerca[0][f]; continue; }
    let num = 0, den = 0;
    for (const s of cerca) { const w = 1 / Math.pow(s.d, power); num += w * s[f]; den += w; }
    out[f] = num / den;
  }
  return out;
}

// Intensidad para duración t (min) a partir de la lluvia de 2 h (Sherman)
export function intensidad(P2h_mm, t_min, n = DEFAULTS.n_idf) {
  const i2h = P2h_mm / 2;
  return i2h * Math.pow(120 / Math.max(t_min, 5), n);
}

// ---------------------------------------------------------------------------
// Caudales
// ---------------------------------------------------------------------------
export function caudalRacional(C, i_mmh, A_km2) {
  return (C * i_mmh * A_km2) / 3.6;
}
export function coefUniformidadTemez(tc_min) {
  const tch = tc_min / 60;
  const t125 = Math.pow(tch, 1.25);
  return 1 + t125 / (t125 + 14);
}
// Lámina para una duración D (min) a partir de la de 2 h: P(D) = i(D)·D
export function laminaDuracion(P2h_mm, D_min, n = DEFAULTS.n_idf) {
  return (intensidad(P2h_mm, D_min, n) * D_min) / 60;
}

// Hidrograma unitario triangular SCS. Tormenta de diseño de duración
// D = max(tc, 2 h): no se acorta por debajo de las 2 h de los datos FONAG,
// y se alarga (escalando la lámina por IDF) cuando la cuenca es lenta.
export function caudalSCS(P2h_mm, CN, A_km2, tc_min, n = DEFAULTS.n_idf) {
  const D_min = Math.max(tc_min, 120);
  const P = laminaDuracion(P2h_mm, D_min, n);
  const S = 25400 / CN - 254;
  const Ia = 0.2 * S;
  const Pe = P > Ia ? Math.pow(P - Ia, 2) / (P + 0.8 * S) : 0;
  const tch = tc_min / 60;
  const Dh = D_min / 60;
  const tlag = 0.6 * tch;
  const tp = Dh / 2 + tlag;              // h
  const qp = tp > 0 ? (0.208 * A_km2 * Pe) / tp : 0;
  return { D_min, P_mm: P, S, Ia, Pe, tp_h: tp, tb_h: 2.67 * tp, Q: qp };
}

export function clasificarMetodo(A_km2, opts = DEFAULTS) {
  if (A_km2 <= opts.lim_racional_km2) return { key: "racional", nombre: "Método racional", nota: "Cuenca pequeña: rango de validez del método racional." };
  if (A_km2 <= opts.lim_racional_ext_km2) return { key: "racional_ext", nombre: "Método racional (con reserva)", nota: "Entre 2,5 y 10 km² el racional tiende a sobreestimar; se muestra también el racional modificado de Témez. Verificar con hidrograma." };
  return { key: "scs", nombre: "Hidrograma unitario SCS", nota: "Cuenca mayor a 10 km²: fuera del rango del racional; se usa el hidrograma unitario triangular del SCS con número de curva." };
}

// Cálculo completo para un punto ya localizado
export function calcular(graph, idSalida, lat, lon, trKey = "tr10", opts = DEFAULTS) {
  const cuenca = delinear(graph, idSalida);
  const tc = tiempoConcentracion(cuenca, opts);
  const lluvia = lluviaEnPunto(lat, lon);
  const metodo = clasificarMetodo(cuenca.area_km2, opts);

  const porTR = TR_OPTIONS.map((tr) => {
    const P = lluvia[`${tr.key}_mm`];
    const i = intensidad(P, tc.tc_min, opts.n_idf);
    const Qr = caudalRacional(cuenca.c_rac, i, cuenca.area_km2);
    const K = coefUniformidadTemez(tc.tc_min);
    const scs = caudalSCS(P, cuenca.cn, cuenca.area_km2, tc.tc_min, opts.n_idf);
    const Qrec = metodo.key === "scs" ? scs.Q : metodo.key === "racional_ext" ? Qr : Qr;
    return { ...tr, P2h_mm: P, i_mmh: i, Q_racional: Qr, K_temez: K, Q_temez: Qr * K, scs, Q_recomendado: Qrec };
  });
  const sel = porTR.find((r) => r.key === trKey) || porTR[2];

  return { cuenca, tc, lluvia, metodo, porTR, sel, trKey, opts };
}

export const fmt = {
  n: (v, d = 1) => (v == null || Number.isNaN(v) ? "—" : Number(v).toLocaleString("es-EC", { minimumFractionDigits: d, maximumFractionDigits: d })),
  km2: (v) => (v < 1 ? `${fmt.n(v * 100, 1)} ha` : `${fmt.n(v, v < 10 ? 2 : 1)} km²`),
  m: (v) => `${fmt.n(v, 0)} m`,
  pct: (v) => `${fmt.n(v * 100, 0)} %`,
  q: (v) => (v < 1 ? `${fmt.n(v * 1000, 0)} L/s` : `${fmt.n(v, v < 10 ? 2 : 1)} m³/s`),
};
