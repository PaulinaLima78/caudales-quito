import React, { useEffect, useMemo, useRef, useState } from "react";
import { Droplets, MapPin, Mountain, Timer, Waves, AlertTriangle, Info } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  loadData, findSubcuenca, calcular, TR_OPTIONS, DEFAULTS, fmt, STATIONS,
} from "./hidro.js";

const INK = "#1F2A24";
const GREEN = "#2F6F5E";
const RIVER = "#2C6FB5";
const CAUCE = "#C9562B";

export default function CaudalesApp() {
  const [graph, setGraph] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [punto, setPunto] = useState(null);          // { lat, lon }
  const [trKey, setTrKey] = useState("tr10");
  const [tecnica, setTecnica] = useState(false);
  const [techTab, setTechTab] = useState("geo");
  const [opts, setOpts] = useState(DEFAULTS);
  const [showAbout, setShowAbout] = useState(false);
  const [fuera, setFuera] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [msgBusqueda, setMsgBusqueda] = useState("");

  useEffect(() => {
    loadData().then(setGraph).catch((e) => setLoadError(String(e)));
  }, []);

  const resultado = useMemo(() => {
    if (!graph || !punto) return null;
    const f = findSubcuenca(graph, punto.lon, punto.lat);
    if (!f) return null;
    return calcular(graph, f.properties.id_tramo, punto.lat, punto.lon, trKey, opts);
  }, [graph, punto, trKey, opts]);

  const buscar = async () => {
    const q = busqueda.trim();
    if (!q) return;
    setMsgBusqueda("");
    const m = q.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
    if (m) {
      const lat = parseFloat(m[1].replace(",", ".")), lon = parseFloat(m[2].replace(",", "."));
      if (Math.abs(lat) <= 2 && lon < -77 && lon > -80) { onClickMapa(lat, lon); return; }
      setMsgBusqueda("Coordenadas fuera de Quito. Usa latitud, longitud en grados decimales, p. ej. -0.1805, -78.4678.");
      return;
    }
    setBuscando(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ec&viewbox=-79.0,0.35,-78.1,-0.65&bounded=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { "Accept-Language": "es" } });
      const data = await res.json();
      if (!data.length) { setMsgBusqueda("No se encontró ese lugar dentro del DMQ. Prueba con otro nombre o haz clic en el mapa."); }
      else onClickMapa(parseFloat(data[0].lat), parseFloat(data[0].lon));
    } catch {
      setMsgBusqueda("No se pudo consultar el buscador de lugares. Haz clic directamente en el mapa.");
    } finally { setBuscando(false); }
  };

  const onClickMapa = (lat, lon) => {
    if (!graph) return;
    const f = findSubcuenca(graph, lon, lat);
    setFuera(!f);
    setPunto({ lat, lon });
  };

  return (
    <div className="min-h-screen bg-[#F6F4EE] text-[#1F2A24]">
      <header className="max-w-6xl mx-auto px-4 pt-8 pb-4">
        <div className="flex items-start gap-3">
          <Waves className="w-8 h-8 mt-1" style={{ color: GREEN }} />
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold leading-tight">
              Caudales de diseño por punto · Quito
            </h1>
            <p className="text-sm text-[#1F2A24]/70 mt-1 max-w-2xl">
              Haz clic en cualquier punto del Distrito Metropolitano y obtén su área de aportación,
              tiempo de concentración y caudal de diseño para el período de retorno que elijas.
            </p>
            <p className="text-xs font-medium mt-2" style={{ color: GREEN }}>
              Por Paulina Lima · lluvias FONAG · DEM Copernicus · uso de suelo ESA WorldCover
            </p>
            <button onClick={() => setShowAbout((v) => !v)}
              className="mt-2 text-xs text-[#1F2A24]/50 underline underline-offset-2 hover:text-[#2F6F5E]">
              {showAbout ? "Cerrar guía de uso ↑" : "¿Qué es esta app y cómo usarla?"}
            </button>
          </div>
        </div>
        {showAbout && <Acerca />}
      </header>

      <main className="max-w-6xl mx-auto px-4 pb-16 space-y-4">
        {/* Controles */}
        <div className="flex flex-wrap items-center gap-3 bg-white rounded-2xl border border-[#1F2A24]/10 px-4 py-3">
          <span className="text-sm text-[#1F2A24]/70">Período de retorno</span>
          <div className="flex rounded-xl overflow-hidden border border-[#1F2A24]/15">
            {TR_OPTIONS.map((t) => (
              <button key={t.key} onClick={() => setTrKey(t.key)}
                className={`px-3 py-1.5 text-sm ${trKey === t.key ? "text-white" : "bg-white hover:bg-[#F6F4EE]"}`}
                style={trKey === t.key ? { background: GREEN } : {}}>
                {t.T} años
              </button>
            ))}
          </div>
          <span className="text-xs text-[#1F2A24]/50 hidden md:inline">
            {TR_OPTIONS.find((t) => t.key === trKey).uso}
          </span>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className={tecnica ? "text-[#1F2A24]/50" : "font-medium"}>Simple</span>
            <button onClick={() => setTecnica((v) => !v)} aria-label="Cambiar vista"
              className="w-11 h-6 rounded-full relative transition-colors"
              style={{ background: tecnica ? GREEN : "#C9CCC6" }}>
              <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
                style={{ left: tecnica ? "22px" : "2px" }} />
            </button>
            <span className={tecnica ? "font-medium" : "text-[#1F2A24]/50"}>Técnica</span>
          </div>
        </div>

        {/* Indicación y búsqueda del punto */}
        <div className="bg-white rounded-2xl border border-[#1F2A24]/10 px-4 py-3 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-7 h-7 rounded-full text-white flex items-center justify-center shrink-0" style={{ background: GREEN }}>
              <MapPin className="w-4 h-4" />
            </span>
            <span>
              <strong>Señala el punto de interés en el mapa</strong> (un cruce de quebrada, una alcantarilla, la entrada a un SUDS)
              {punto ? " o elige otro." : "."}
            </span>
          </div>
          <div className="md:ml-auto flex items-center gap-2">
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && buscar()}
              placeholder="o escribe un lugar / coordenadas"
              className="border border-[#1F2A24]/20 rounded-lg px-3 py-1.5 text-sm w-64 bg-[#F6F4EE]" />
            <button onClick={buscar} disabled={buscando || !graph}
              className="px-3 py-1.5 rounded-lg text-sm text-white disabled:opacity-50" style={{ background: GREEN }}>
              {buscando ? "Buscando…" : "Ubicar"}
            </button>
          </div>
        </div>
        {msgBusqueda && <Aviso>{msgBusqueda}</Aviso>}

        {/* Mapa */}
        <div className="relative bg-white rounded-2xl border border-[#1F2A24]/10 overflow-hidden">
          <Mapa graph={graph} punto={punto} resultado={resultado} onClick={onClickMapa} />
          {!graph && !loadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-sm">
              Cargando red hidrográfica del DMQ (6.148 subcuencas)…
            </div>
          )}
          {loadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/90 text-sm text-red-700 px-6 text-center">
              No se pudieron cargar los datos ({loadError}). Revisa que exista la carpeta public/data.
            </div>
          )}
        </div>

        {fuera && punto && (
          <Aviso>El punto está fuera del área de estudio (DMQ + 5 km). Elige un punto dentro del distrito.</Aviso>
        )}

        {resultado && !tecnica && <VistaSimple r={resultado} />}
        {resultado && tecnica && (
          <VistaTecnica r={resultado} techTab={techTab} setTechTab={setTechTab} opts={opts} setOpts={setOpts} />
        )}

        {resultado && (
          <p className="text-[#1F2A24]/40 text-xs">
            Resultados orientativos para anteproyecto. No reemplazan un estudio hidrológico detallado ni la verificación de un ingeniero.
            Metodología: Paulina Lima · Datos: FONAG, Copernicus DEM GLO-30, ESA WorldCover 2021.
          </p>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Aviso({ children, tipo = "warn" }) {
  return (
    <div className={`flex gap-2 items-start rounded-xl px-4 py-3 text-sm ${tipo === "warn" ? "bg-amber-50 text-amber-900 border border-amber-200" : "bg-[#2F6F5E]/10 border border-[#2F6F5E]/20"}`}>
      {tipo === "warn" ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <Info className="w-4 h-4 mt-0.5 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

function Dato({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-white rounded-2xl border border-[#1F2A24]/10 p-4">
      <div className="flex items-center gap-2 text-xs text-[#1F2A24]/60">
        <Icon className="w-4 h-4" style={{ color: GREEN }} /> {label}
      </div>
      <div className="text-2xl md:text-3xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-[#1F2A24]/50 mt-1">{sub}</div>}
    </div>
  );
}

function VistaSimple({ r }) {
  const { cuenca, tc, sel, metodo } = r;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Dato icon={Mountain} label="Área de aportación" value={fmt.km2(cuenca.area_km2)}
          sub={`${cuenca.n} subcuenca${cuenca.n > 1 ? "s" : ""} · ${fmt.pct(cuenca.uso.urbano)} urbano`} />
        <Dato icon={Waves} label="Cauce principal" value={`${fmt.n(cuenca.L_m / 1000, cuenca.L_m < 10000 ? 2 : 1)} km`}
          sub={`Pendiente ${fmt.n(cuenca.S_cauce * 100, 1)} % · desnivel ${fmt.m(cuenca.desnivel_m)}`} />
        <Dato icon={Timer} label="Tiempo de concentración" value={tc.tc_min < 120 ? `${fmt.n(tc.tc_min, 0)} min` : `${fmt.n(tc.tc_min / 60, 1)} h`}
          sub={tc.metodo === "kirpich" ? "Kirpich" : "Témez"} />
        <Dato icon={Droplets} label={`Caudal de diseño · ${sel.label}`} value={fmt.q(sel.Q_recomendado)}
          sub={metodo.nombre} />
      </div>
      <Aviso tipo={metodo.key === "racional" ? "info" : "warn"}>
        {metodo.nota} Lluvia de diseño: {fmt.n(sel.P2h_mm, 1)} mm en 2 h ({sel.label}), interpolada de las estaciones FONAG más cercanas
        ({r.lluvia.estaciones.slice(0, 2).map((e) => e.name).join(" y ")}).
      </Aviso>
    </div>
  );
}

// ---------------------------------------------------------------------------
function VistaTecnica({ r, techTab, setTechTab, opts, setOpts }) {
  const tabs = [
    { key: "geo", label: "Geomorfología" },
    { key: "uso", label: "Uso del suelo" },
    { key: "lluvia", label: "Lluvia" },
    { key: "caudal", label: "Caudales" },
    { key: "teoria", label: "Teoría y supuestos" },
  ];
  return (
    <div className="bg-white rounded-2xl border border-[#1F2A24]/10">
      <div className="flex flex-wrap border-b border-[#1F2A24]/10">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTechTab(t.key)}
            className={`px-4 py-3 text-sm border-b-2 -mb-px ${techTab === t.key ? "font-medium" : "text-[#1F2A24]/60 border-transparent hover:text-[#1F2A24]"}`}
            style={techTab === t.key ? { borderColor: GREEN, color: GREEN } : {}}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-4 md:p-6 text-sm">
        {techTab === "geo" && <TabGeo r={r} />}
        {techTab === "uso" && <TabUso r={r} />}
        {techTab === "lluvia" && <TabLluvia r={r} />}
        {techTab === "caudal" && <TabCaudal r={r} />}
        {techTab === "teoria" && <TabTeoria r={r} opts={opts} setOpts={setOpts} />}
      </div>
    </div>
  );
}

function Tabla({ filas, head, mono = true }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {head && (
          <thead><tr className="text-left text-xs text-[#1F2A24]/60 border-b border-[#1F2A24]/10">
            {head.map((h, i) => <th key={i} className={`py-2 pr-4 font-medium ${i > 0 ? "text-right" : ""}`}>{h}</th>)}
          </tr></thead>
        )}
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-b border-[#1F2A24]/5 last:border-0">
              {f.map((c, j) => <td key={j} className={`py-2 pr-4 align-top ${j > 0 ? `text-right ${mono ? "font-mono" : ""}` : ""}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Geomorfología ----------
function clasifKc(kc) {
  if (kc == null) return "—";
  if (kc < 1.25) return "Redonda a oval-redonda: concentra rápido la escorrentía, picos altos";
  if (kc < 1.5) return "Oval-redonda a oval-oblonga: respuesta intermedia";
  if (kc < 1.75) return "Oval-oblonga a rectangular-oblonga: respuesta lenta";
  return "Rectangular-oblonga, muy alargada: picos atenuados";
}
function clasifDd(dd) {
  if (dd < 0.5) return "Baja: suelos permeables o poca disección";
  if (dd < 1.5) return "Media";
  if (dd < 3.5) return "Alta: suelos poco permeables, relieve disectado";
  return "Muy alta";
}
function clasifPend(p) {
  if (p < 3) return "Plano";
  if (p < 7) return "Suave";
  if (p < 12) return "Medianamente accidentado";
  if (p < 20) return "Accidentado";
  if (p < 35) return "Fuertemente accidentado";
  if (p < 50) return "Muy fuertemente accidentado";
  return "Escarpado";
}

function TabGeo({ r }) {
  const c = r.cuenca, tc = r.tc;
  const fila = (nombre, formula, valor, interp) => [
    <div><div>{nombre}</div>{formula && <div className="text-[11px] text-[#1F2A24]/50 font-mono">{formula}</div>}</div>,
    valor,
    <span className="font-sans text-xs text-[#1F2A24]/70 text-left block max-w-xs">{interp}</span>,
  ];
  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-medium mb-2">Parámetros de tamaño y relieve</h3>
          <Tabla head={["Parámetro", "Valor", ""]} filas={[
            fila("Área de aportación (A)", null, fmt.km2(c.area_km2), `${c.n} subcuenca${c.n > 1 ? "s" : ""} agregadas`),
            fila("Perímetro (P)", "contorno generalizado a 100 m", c.perimetro_m ? `${fmt.n(c.perimetro_m / 1000, 1)} km` : "—", ""),
            fila("Cota máxima", null, fmt.m(c.z_max), ""),
            fila("Cota media", "ponderada por área", fmt.m(c.z_med), ""),
            fila("Cota en la salida", null, fmt.m(c.z_salida), ""),
            fila("Relieve máximo (H)", "z máx − z mín", fmt.m(c.relieve_m), ""),
            fila("Pendiente media del terreno", "media de celdas del DEM", `${fmt.n(c.pend_pct, 1)} %`, clasifPend(c.pend_pct)),
          ]} />
        </div>
        <div>
          <h3 className="font-medium mb-2">Red de drenaje</h3>
          <Tabla head={["Parámetro", "Valor", ""]} filas={[
            fila("Orden de la cuenca (Strahler)", "orden del tramo de salida", c.orden_max ?? "—", c.orden_max >= 4 ? "Red jerarquizada, cuenca grande" : c.orden_max >= 2 ? "Red con afluentes" : "Cauce de cabecera sin afluentes"),
            fila("Número de tramos", null, c.n, ""),
            fila("Longitud total de cauces (ΣL)", null, `${fmt.n(c.L_total_m / 1000, 1)} km`, ""),
            fila("Longitud del cauce principal (L)", "camino más largo", `${fmt.n(c.L_m / 1000, 2)} km`, ""),
            fila("Desnivel del cauce principal", "z inicio − z salida", fmt.m(c.desnivel_m), ""),
            fila("Pendiente del cauce principal (S)", "desnivel / L", `${fmt.n(c.S_cauce * 100, 2)} %`, ""),
            fila("Densidad de drenaje (Dd)", "ΣL / A", `${fmt.n(c.Dd, 2)} km/km²`, clasifDd(c.Dd)),
          ]} />
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-medium mb-2">Índices de forma</h3>
          <Tabla head={["Índice", "Valor", "Interpretación"]} filas={[
            fila("Compacidad de Gravelius (Kc)", "0,28·P / √A", c.Kc ? fmt.n(c.Kc, 2) : "—", clasifKc(c.Kc)),
            fila("Factor de forma de Horton (Kf)", "A / L²", fmt.n(c.Kf, 2), c.Kf > 0.5 ? "Cuenca ancha: tendencia a crecidas súbitas" : c.Kf > 0.25 ? "Forma intermedia" : "Cuenca alargada: crecidas atenuadas"),
            fila("Relación de elongación (Re)", "1,128·√A / L", fmt.n(c.Re, 2), c.Re > 0.8 ? "Poco alargada" : c.Re > 0.6 ? "Alargamiento moderado" : "Muy alargada"),
          ]} />
        </div>
        <div>
          <h3 className="font-medium mb-2">Tiempo de concentración</h3>
          <Tabla head={["Fórmula", "Valor", ""]} filas={[
            fila("Kirpich (1940)", "0,0195·L^0,77·S^−0,385", `${fmt.n(tc.kirpich, 1)} min`, "Cuencas pequeñas y medianas con pendiente definida"),
            fila("Témez (1978)", "0,3·(L/S^0,25)^0,76", `${fmt.n(tc.temez, 1)} min`, "Cuencas medianas y grandes"),
            fila(`Adoptado (${tc.metodo === "kirpich" ? "Kirpich" : "Témez"})`, null, <strong>{fmt.n(tc.tc_min, 1)} min</strong>, "Selección automática por tamaño; editable en Teoría"),
          ]} />
        </div>
      </div>
    </div>
  );
}

// ---------- Uso del suelo ----------
const CLASES_USO = [
  { key: "urbano", nombre: "Urbano (edificado, vías)", cn: "90", c: "0,75", color: "#8C5A3C" },
  { key: "vegetacion", nombre: "Vegetación (bosque, matorral, páramo, humedal)", cn: "70 – 85", c: "0,30 – 0,50", color: "#2F6F5E" },
  { key: "cultivo", nombre: "Cultivos", cn: "81", c: "0,45", color: "#C9A227" },
  { key: "desnudo", nombre: "Suelo desnudo / nieve", cn: "91 – 98", c: "0,60 – 0,90", color: "#B0A99A" },
  { key: "agua", nombre: "Cuerpos de agua", cn: "100", c: "1,00", color: "#2C6FB5" },
];
function TabUso({ r }) {
  const c = r.cuenca, u = c.uso;
  const A = c.area_km2;
  const filas = CLASES_USO.map((k) => ({ ...k, frac: u[k.key] || 0, area: (u[k.key] || 0) * A })).filter((k) => k.frac > 0.0005);
  return (
    <div className="grid md:grid-cols-5 gap-6">
      <div className="md:col-span-3">
        <h3 className="font-medium mb-2">Cobertura del suelo en la cuenca (ESA WorldCover 2021, 10 m)</h3>
        <div className="flex h-4 rounded-full overflow-hidden mb-3 border border-[#1F2A24]/10">
          {filas.map((k) => <div key={k.key} style={{ width: `${k.frac * 100}%`, background: k.color }} title={`${k.nombre}: ${fmt.pct(k.frac)}`} />)}
        </div>
        <Tabla head={["Clase", "Área", "% cuenca", "CN (grupo C)", "C racional"]} filas={[
          ...filas.map((k) => [
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: k.color }} />{k.nombre}</span>,
            fmt.km2(k.area), fmt.pct(k.frac), k.cn, k.c,
          ]),
          [<strong>Total / ponderado por área</strong>, <strong>{fmt.km2(A)}</strong>, <strong>100 %</strong>, <strong>{fmt.n(c.cn, 1)}</strong>, <strong>{fmt.n(c.c_rac, 2)}</strong>],
        ]} />
        <p className="text-xs text-[#1F2A24]/60 mt-3">
          El CN y el C de la cuenca son la media ponderada por área de los valores de cada subcuenca, calculados en ArcGIS con la tabla completa de 11 clases WorldCover
          (TR-55 y Chow). Los rangos de la tabla indican los valores de las subclases agrupadas. Grupo hidrológico de suelo asumido: C (suelos volcánicos y cangahua).
        </p>
      </div>
      <div className="md:col-span-2 space-y-3">
        <h3 className="font-medium mb-2">Respuesta hidrológica</h3>
        <Tabla filas={[
          ["Número de curva CN (AMC II)", fmt.n(c.cn, 1)],
          ["Retención potencial S = 25400/CN − 254", `${fmt.n(25400 / c.cn - 254, 0)} mm`],
          ["Abstracción inicial Ia = 0,2·S", `${fmt.n(0.2 * (25400 / c.cn - 254), 1)} mm`],
          ["Coeficiente de escorrentía C", fmt.n(c.c_rac, 2)],
          ["Fracción impermeable aprox.", fmt.pct(u.urbano * 0.65 + u.agua)],
        ]} />
        <p className="text-xs text-[#1F2A24]/60">
          Lectura: un CN de {fmt.n(c.cn, 0)} implica que los primeros {fmt.n(0.2 * (25400 / c.cn - 254), 0)} mm de lluvia no generan escorrentía.
          {u.urbano > 0.4 ? " La cuenca es predominantemente urbana: respuesta rápida y picos altos; el método racional con C ponderado es adecuado." :
           u.urbano > 0.15 ? " Cuenca mixta: revisar si la urbanización futura elevará el C." :
           " Cuenca predominantemente natural: el páramo y el bosque amortiguan la escorrentía; el CN gobierna el resultado más que el C."}
        </p>
      </div>
    </div>
  );
}

function TabLluvia({ r }) {
  const l = r.lluvia;
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <h3 className="font-medium mb-2">Lluvia de diseño en el punto (2 h, Gumbel)</h3>
        <p className="text-xs text-[#1F2A24]/60 mb-2">
          Interpolación inversa a la distancia (1/d²) entre las 4 estaciones FONAG más cercanas, igual que en la app de SUDS.
        </p>
        <Tabla head={["Período de retorno", "Lluvia 2 h", "i media 2 h", `i para tc = ${fmt.n(r.tc.tc_min, 0)} min`]}
          filas={r.porTR.map((t) => [t.label, `${fmt.n(t.P2h_mm, 1)} mm`, `${fmt.n(t.P2h_mm / 2, 1)} mm/h`, `${fmt.n(t.i_mmh, 1)} mm/h`])} />
      </div>
      <div>
        <h3 className="font-medium mb-2">Estaciones usadas</h3>
        <Tabla head={["Estación", "Distancia", "TR10 (2 h)"]}
          filas={l.estaciones.map((e) => {
            const s = STATIONS.find((x) => x.id === e.id);
            return [`${e.name} (${e.code})`, `${fmt.n(e.distanceKm, 1)} km`, `${fmt.n(s.tr10_mm, 1)} mm`];
          })} />
      </div>
    </div>
  );
}

function TabCaudal({ r }) {
  const m = r.metodo;
  const A = r.cuenca.area_km2;
  return (
    <div className="space-y-4">
      <Aviso tipo={m.key === "racional" ? "info" : "warn"}>
        <strong>{m.nombre}.</strong> {m.nota}
      </Aviso>
      <Tabla head={["Período de retorno", "Racional", "Racional mod. Témez", "SCS triangular", "Recomendado"]}
        filas={r.porTR.map((t) => [
          <span className={t.key === r.trKey ? "font-medium" : ""}>{t.label}</span>,
          <span className={A > r.opts.lim_racional_ext_km2 ? "text-[#1F2A24]/40" : ""}>{fmt.q(t.Q_racional)}</span>,
          <span className={A > r.opts.lim_racional_ext_km2 || A <= r.opts.lim_racional_km2 ? "text-[#1F2A24]/40" : ""}>{fmt.q(t.Q_temez)}</span>,
          <span className={A <= r.opts.lim_racional_ext_km2 ? "text-[#1F2A24]/40" : ""}>{fmt.q(t.scs.Q)}</span>,
          <strong>{fmt.q(t.Q_recomendado)}</strong>,
        ])} />
      <div className="grid md:grid-cols-3 gap-4 text-xs text-[#1F2A24]/70">
        <div>
          <p className="font-medium text-[#1F2A24]">Racional ({r.sel.label})</p>
          <p className="font-mono">Q = C·i·A / 3,6</p>
          <p>C = {fmt.n(r.cuenca.c_rac, 2)} · i = {fmt.n(r.sel.i_mmh, 1)} mm/h · A = {fmt.n(A, 3)} km²</p>
        </div>
        <div>
          <p className="font-medium text-[#1F2A24]">Témez modificado</p>
          <p className="font-mono">Q = K · C·i·A / 3,6</p>
          <p>K = 1 + tc^1,25 / (tc^1,25 + 14) = {fmt.n(r.sel.K_temez, 3)} (tc en h)</p>
        </div>
        <div>
          <p className="font-medium text-[#1F2A24]">SCS triangular</p>
          <p className="font-mono">Qp = 0,208·A·Pe / tp</p>
          <p>Tormenta {fmt.n(r.sel.scs.D_min / 60, 1)} h: P = {fmt.n(r.sel.scs.P_mm, 1)} mm · S = {fmt.n(r.sel.scs.S, 0)} mm · Pe = {fmt.n(r.sel.scs.Pe, 1)} mm · tp = {fmt.n(r.sel.scs.tp_h, 2)} h</p>
        </div>
      </div>
    </div>
  );
}

// ---------- Teoría ----------
function Bloque({ titulo, children }) {
  return (
    <section className="space-y-1.5">
      <h4 className="font-medium text-sm text-[#1F2A24]">{titulo}</h4>
      <div className="text-xs text-[#1F2A24]/75 leading-relaxed space-y-1.5">{children}</div>
    </section>
  );
}
function F({ children }) { return <p className="font-mono bg-[#F6F4EE] rounded px-2 py-1 inline-block">{children}</p>; }

function TabTeoria({ r, opts, setOpts }) {
  const set = (k, v) => setOpts({ ...opts, [k]: v });
  return (
    <div className="grid md:grid-cols-3 gap-8">
      <div className="md:col-span-2 space-y-6">
        <Bloque titulo="1. Delimitación de la cuenca">
          <p>Una cuenca es el territorio cuya escorrentía superficial converge a un mismo punto de salida. Se obtiene del modelo digital de elevación (DEM): tras rellenar depresiones espurias (<em>Fill</em>), a cada celda se le asigna la dirección de máxima pendiente hacia una de sus 8 vecinas (algoritmo D8) y se cuenta cuántas celdas drenan a cada una (<em>acumulación de flujo</em>). Las celdas con acumulación mayor a un umbral (aquí 0,5 km²) forman la red de drenaje; cada tramo entre confluencias tiene su propia subcuenca (<em>Watershed</em>).</p>
          <p>La app no recalcula esto en línea: el DMQ se dividió previamente en 6.148 subcuencas que conocen su tramo receptor. Al elegir un punto, se localiza su subcuenca y se suman todas las que drenan hacia ella recorriendo la red aguas arriba. Por eso el punto de salida efectivo es el extremo aguas abajo del tramo, no el clic exacto.</p>
        </Bloque>
        <Bloque titulo="2. Geomorfología: por qué importa la forma">
          <p>Dos cuencas con la misma área pueden responder de forma muy distinta a la misma lluvia. Una cuenca redonda y con alta densidad de drenaje concentra el agua rápidamente (hidrograma con pico alto y corto); una alargada lo distribuye en el tiempo.</p>
          <F>Kc = 0,28 · P / √A</F> <span>Gravelius: 1 = círculo; mayor a 1,5 = alargada.</span><br />
          <F>Kf = A / L²</F> <span>Horton: mayor a 0,5 = ancha, crecidas súbitas.</span><br />
          <F>Re = 1,128 · √A / L</F> <span>Schumm: relación entre el diámetro del círculo equivalente y la longitud del cauce.</span><br />
          <F>Dd = ΣL / A</F> <span>Densidad de drenaje (km/km²): eficiencia de la red para evacuar el agua; alta en suelos poco permeables.</span>
          <p>Orden de Strahler: los cauces de cabecera son de orden 1; dos de igual orden n forman uno de orden n+1. El orden de la cuenca es el del tramo de salida y refleja la jerarquía de la red.</p>
        </Bloque>
        <Bloque titulo="3. Tiempo de concentración (tc)">
          <p>Es el tiempo que tarda una gota caída en el punto hidráulicamente más lejano en llegar a la salida. Es la duración de lluvia crítica: una tormenta más corta no involucra toda la cuenca; una más larga tiene menor intensidad.</p>
          <F>Kirpich: tc = 0,0195 · L^0,77 · S^−0,385</F> <span>(min; L en m; S en m/m)</span><br />
          <F>Témez: tc = 0,3 · (L / S^0,25)^0,76</F> <span>(h; L en km)</span>
          <p>Kirpich se desarrolló en cuencas pequeñas de Tennessee y tiende a subestimar en cuencas grandes; Témez proviene de cuencas españolas medianas. La app usa Kirpich hasta 10 km² y Témez por encima, con un mínimo de {opts.tc_min_min} min.</p>
        </Bloque>
        <Bloque titulo="4. Lluvia de diseño">
          <p>Para cada estación FONAG se tomaron los máximos anuales de lluvia en 2 h y se ajustó una distribución de Gumbel, que da la lámina asociada a cada período de retorno TR (probabilidad anual de excedencia 1/TR). El valor en el punto se interpola con inverso de la distancia (1/d²) entre las 4 estaciones más cercanas.</p>
          <p>Como el método racional necesita la intensidad para una duración igual al tc, se escala la intensidad de 2 h con una relación tipo Sherman:</p>
          <F>i(t) = i₂ₕ · (120 / t)ⁿ</F> <span>n = {opts.n_idf} (valores típicos 0,5-0,7 en la Sierra)</span>
          <p><strong>Este es el supuesto más sensible del cálculo.</strong> Debe reemplazarse por las curvas IDF oficiales de EPMAPS/INAMHI en cuanto estén disponibles; el resto de la cadena no cambia.</p>
        </Bloque>
        <Bloque titulo="5. Métodos de cálculo del caudal">
          <p><strong>Racional.</strong> Supone lluvia uniforme sobre toda la cuenca durante un tiempo igual al tc y respuesta lineal:</p>
          <F>Q = C · i · A / 3,6</F> <span>(m³/s; i en mm/h; A en km²)</span>
          <p>C es el coeficiente de escorrentía (fracción de la lluvia que escurre), ponderado por área según la cobertura. Válido hasta 2,5 km²; entre 2,5 y 10 km² se acepta con reserva porque la lluvia deja de ser uniforme y la cuenca amortigua.</p>
          <p><strong>Racional modificado (Témez).</strong> Corrige la no uniformidad temporal de la lluvia con un coeficiente K que crece con el tc:</p>
          <F>Q = K · C · i · A / 3,6 &nbsp;&nbsp; K = 1 + tc^1,25 / (tc^1,25 + 14)</F> <span>(tc en h)</span>
          <p><strong>Hidrograma unitario SCS.</strong> Para cuencas mayores a 10 km². Primero separa la lluvia efectiva Pe con el número de curva:</p>
          <F>S = 25400/CN − 254 &nbsp;&nbsp; Pe = (P − 0,2·S)² / (P + 0,8·S)</F>
          <p>y luego la transforma en caudal pico con el hidrograma unitario triangular:</p>
          <F>Qp = 0,208 · A · Pe / tp &nbsp;&nbsp; tp = D/2 + 0,6·tc</F> <span>(tp en h; D = duración de la tormenta = máx(tc, 2 h))</span>
          <p>El CN (0-100) resume cobertura, uso y grupo hidrológico del suelo; un CN alto significa poca infiltración. La app usa condición de humedad antecedente media (AMC II) y grupo C.</p>
        </Bloque>
        <Bloque titulo="6. Período de retorno y tipo de obra">
          <p>TR 2-5 años: alcantarillado domiciliario y secundario. TR 10: colectores principales y drenaje vial urbano. TR 25: alcantarillas de carretera, puentes menores, SUDS de detención. Obras mayores (presas, puentes principales) exigen TR 50-100 y estudios específicos que exceden esta herramienta.</p>
        </Bloque>
        <Bloque titulo="7. Limitaciones">
          <p>DEM de 30 m (modelo de superficie, incluye edificios y vegetación) y subcuencas de ~1 km²: el área es confiable, pero el punto de salida se ajusta al tramo. Uso de suelo de 2021. Grupo hidrológico único. Curvas IDF aproximadas. No considera redes de alcantarillado, embalses, trasvases ni control de obras existentes. Resultados para anteproyecto, no para diseño definitivo.</p>
          <p className="text-[#1F2A24]/50">Referencias: Chow, Maidment &amp; Mays (1988) <em>Applied Hydrology</em>; USDA-SCS (1986) TR-55; Témez (1978, 1991); Kirpich (1940); Gravelius (1914); Horton (1932); Strahler (1957); Gumbel (1958); Zanaga et al. (2022) ESA WorldCover; Copernicus DEM GLO-30.</p>
        </Bloque>
      </div>
      <div className="space-y-3">
        <h3 className="font-medium">Parámetros ajustables</h3>
        <label className="block">
          <span className="text-xs text-[#1F2A24]/60">Exponente IDF n</span>
          <input type="number" step="0.05" min="0.3" max="0.9" value={opts.n_idf}
            onChange={(e) => set("n_idf", Number(e.target.value) || DEFAULTS.n_idf)}
            className="mt-1 w-32 block border border-[#1F2A24]/20 rounded-lg px-2 py-1 font-mono" />
        </label>
        <label className="block">
          <span className="text-xs text-[#1F2A24]/60">Fórmula de tc</span>
          <select value={opts.metodo_tc} onChange={(e) => set("metodo_tc", e.target.value)}
            className="mt-1 block border border-[#1F2A24]/20 rounded-lg px-2 py-1 bg-white text-sm">
            <option value="auto">Automático por tamaño</option>
            <option value="kirpich">Kirpich</option>
            <option value="temez">Témez</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-[#1F2A24]/60">tc mínimo (min)</span>
          <input type="number" step="1" min="5" max="30" value={opts.tc_min_min}
            onChange={(e) => set("tc_min_min", Number(e.target.value) || 10)}
            className="mt-1 w-32 block border border-[#1F2A24]/20 rounded-lg px-2 py-1 font-mono" />
        </label>
        <button onClick={() => setOpts(DEFAULTS)} className="text-xs underline text-[#1F2A24]/60">Restablecer valores por defecto</button>
        <div className="text-xs text-[#1F2A24]/60 pt-3 border-t border-[#1F2A24]/10">
          Los cambios se aplican al instante a la cuenca seleccionada. Úsalos para ver la sensibilidad del caudal a cada supuesto.
        </div>
      </div>
    </div>
  );
}

function Acerca() {
  return (
    <div className="mt-4 bg-white rounded-2xl border border-[#1F2A24]/10 p-5 text-sm space-y-2 max-w-3xl">
      <p>Esta herramienta responde una pregunta frecuente en el anteproyecto de obras de drenaje, puentes, alcantarillas y SUDS: <strong>¿cuánta agua llega a este punto?</strong></p>
      <ol className="list-decimal ml-5 space-y-1">
        <li>Elige el período de retorno según el tipo de obra (2-5 años alcantarillado, 10 colectores, 25 obras mayores).</li>
        <li>Haz clic en el mapa sobre el punto de salida: un cruce de quebrada, una alcantarilla, la entrada a un SUDS.</li>
        <li>Lee el área de aportación (resaltada en verde), el cauce principal (naranja) y el caudal de diseño. El círculo verde marca el punto de salida efectivo: el extremo aguas abajo del tramo de río al que pertenece tu punto.</li>
        <li>Activa la vista técnica: geomorfología e índices de forma, tabla de uso del suelo con CN y C, lluvia por estación, los tres métodos de cálculo y una pestaña de teoría con las fórmulas y supuestos.</li>
      </ol>
      <p className="text-[#1F2A24]/60">La precisión es la del DEM de 30 m y de subcuencas de ~1 km²: el punto se asocia al tramo de río más cercano. Es una herramienta de anteproyecto complementaria al <a className="underline" href="https://suds-quito.vercel.app" target="_blank" rel="noreferrer">Buscador de SUDS</a>.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mapa Leaflet (paquete npm)
// ---------------------------------------------------------------------------
function Mapa({ graph, punto, resultado, onClick }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    if (mapRef.current) return;
    const map = L.map(divRef.current, { preferCanvas: true, zoomControl: true, scrollWheelZoom: true })
      .setView([-0.20, -78.50], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 18 }).addTo(map);
    map.on("click", (e) => onClickRef.current(e.latlng.lat, e.latlng.lng));
    layersRef.current.estaciones = L.layerGroup(
      STATIONS.map((s) => L.circleMarker([s.lat, s.lon], { radius: 4, color: "#fff", weight: 1, fillColor: GREEN, fillOpacity: 0.9 })
        .bindTooltip(`${s.name} · TR10 ${s.tr10_mm} mm`, { direction: "top" }))
    ).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Red de drenaje
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !graph || layersRef.current.red) return;
    layersRef.current.red = L.geoJSON({ type: "FeatureCollection", features: graph.tramos }, {
      style: (f) => ({ color: RIVER, weight: Math.min(0.6 + (f.properties.orden || 1) * 0.45, 3), opacity: 0.75 }),
      interactive: false,
    }).addTo(map);
  }, [graph]);

  // Cuenca resaltada
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const lr = layersRef.current;
    ["cuenca", "cauce", "marker", "salida"].forEach((k) => { if (lr[k]) { map.removeLayer(lr[k]); lr[k] = null; } });
    if (!punto) return;
    if (!resultado) map.setView([punto.lat, punto.lon], Math.max(map.getZoom(), 13));
    lr.marker = L.circleMarker([punto.lat, punto.lon], { radius: 5, color: INK, weight: 2, fillColor: "#fff", fillOpacity: 1 })
      .bindTooltip("Punto elegido", { direction: "top" }).addTo(map);
    if (!resultado) return;
    const feats = resultado.cuenca.ids.map((id) => graph.byId.get(id));
    lr.cuenca = L.geoJSON({ type: "FeatureCollection", features: feats }, {
      style: { color: GREEN, weight: 1, fillColor: GREEN, fillOpacity: 0.28 }, interactive: false,
    }).addTo(map);
    const cauce = resultado.cuenca.cauce_ids.map((id) => graph.tramoById.get(id)).filter(Boolean);
    lr.cauce = L.geoJSON({ type: "FeatureCollection", features: cauce }, {
      style: { color: CAUCE, weight: 3, opacity: 0.95 }, interactive: false,
    }).addTo(map);
    // Punto de salida efectivo: extremo aguas abajo del tramo de la subcuenca elegida
    const tSal = graph.tramoById.get(resultado.cuenca.idSalida);
    if (tSal) {
      const cs = tSal.geometry.coordinates;
      const [lonS, latS] = cs[cs.length - 1];
      lr.salida = L.circleMarker([latS, lonS], { radius: 8, color: "#fff", weight: 2, fillColor: GREEN, fillOpacity: 1 })
        .bindTooltip("Punto de salida de la cuenca", { direction: "top" }).addTo(map);
    }
    lr.marker.bringToFront();
    const b = lr.cuenca.getBounds();
    if (b.isValid()) map.fitBounds(b.pad(0.25), { maxZoom: 15 });
  }, [punto, resultado, graph]);

  return <div ref={divRef} className="w-full" style={{ height: "62vh", minHeight: 380 }} />;
}
