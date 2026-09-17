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
  const [techTab, setTechTab] = useState("cuenca");
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
    { key: "cuenca", label: "Cuenca" },
    { key: "lluvia", label: "Lluvia" },
    { key: "caudal", label: "Caudales" },
    { key: "metodo", label: "Método y supuestos" },
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
        {techTab === "cuenca" && <TabCuenca r={r} />}
        {techTab === "lluvia" && <TabLluvia r={r} />}
        {techTab === "caudal" && <TabCaudal r={r} />}
        {techTab === "metodo" && <TabMetodo r={r} opts={opts} setOpts={setOpts} />}
      </div>
    </div>
  );
}

function Tabla({ filas, head }) {
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
              {f.map((c, j) => <td key={j} className={`py-2 pr-4 ${j > 0 ? "text-right font-mono" : ""}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabCuenca({ r }) {
  const c = r.cuenca, tc = r.tc;
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <h3 className="font-medium mb-2">Morfometría</h3>
        <Tabla filas={[
          ["Área de aportación", fmt.km2(c.area_km2)],
          ["Subcuencas agregadas", c.n],
          ["Orden de Strahler en la salida", c.orden ?? "—"],
          ["Longitud del cauce principal", `${fmt.n(c.L_m, 0)} m`],
          ["Cota máxima de la cuenca", fmt.m(c.z_max)],
          ["Cota de inicio del cauce principal", fmt.m(c.z_top_cauce)],
          ["Cota en el punto de salida", fmt.m(c.z_salida)],
          ["Desnivel del cauce", fmt.m(c.desnivel_m)],
          ["Pendiente del cauce", `${fmt.n(c.S_cauce * 100, 2)} %`],
          ["Pendiente media del terreno", `${fmt.n(c.pend_pct, 1)} %`],
        ]} />
      </div>
      <div>
        <h3 className="font-medium mb-2">Cobertura y respuesta hidrológica</h3>
        <Tabla filas={[
          ["Urbano", fmt.pct(c.uso.urbano)],
          ["Vegetación (bosque, matorral, páramo)", fmt.pct(c.uso.vegetacion)],
          ["Cultivos", fmt.pct(c.uso.cultivo)],
          ["Suelo desnudo", fmt.pct(c.uso.desnudo)],
          ["Agua", fmt.pct(c.uso.agua)],
          ["Número de curva CN (grupo C, AMC II)", fmt.n(c.cn, 1)],
          ["Coeficiente de escorrentía C", fmt.n(c.c_rac, 2)],
        ]} />
        <h3 className="font-medium mb-2 mt-5">Tiempo de concentración</h3>
        <Tabla filas={[
          ["Kirpich", `${fmt.n(tc.kirpich, 1)} min`],
          ["Témez", `${fmt.n(tc.temez, 1)} min`],
          [`Adoptado (${tc.metodo === "kirpich" ? "Kirpich" : "Témez"})`, `${fmt.n(tc.tc_min, 1)} min`],
        ]} />
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

function TabMetodo({ r, opts, setOpts }) {
  const set = (k, v) => setOpts({ ...opts, [k]: v });
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-3">
        <h3 className="font-medium">Parámetros ajustables</h3>
        <label className="block">
          <span className="text-xs text-[#1F2A24]/60">Exponente IDF n (i = i₂ₕ · (120/t)ⁿ)</span>
          <input type="number" step="0.05" min="0.3" max="0.9" value={opts.n_idf}
            onChange={(e) => set("n_idf", Number(e.target.value) || DEFAULTS.n_idf)}
            className="mt-1 w-32 border border-[#1F2A24]/20 rounded-lg px-2 py-1 font-mono" />
        </label>
        <label className="block">
          <span className="text-xs text-[#1F2A24]/60">Fórmula de tc</span>
          <select value={opts.metodo_tc} onChange={(e) => set("metodo_tc", e.target.value)}
            className="mt-1 block border border-[#1F2A24]/20 rounded-lg px-2 py-1 bg-white">
            <option value="auto">Automático (Kirpich ≤ 10 km², Témez &gt; 10 km²)</option>
            <option value="kirpich">Kirpich</option>
            <option value="temez">Témez</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-[#1F2A24]/60">tc mínimo (min)</span>
          <input type="number" step="1" min="5" max="30" value={opts.tc_min_min}
            onChange={(e) => set("tc_min_min", Number(e.target.value) || 10)}
            className="mt-1 w-32 border border-[#1F2A24]/20 rounded-lg px-2 py-1 font-mono" />
        </label>
        <button onClick={() => setOpts(DEFAULTS)} className="text-xs underline text-[#1F2A24]/60">Restablecer valores por defecto</button>
      </div>
      <div className="space-y-3 text-xs text-[#1F2A24]/75 leading-relaxed">
        <h3 className="font-medium text-sm text-[#1F2A24]">Cómo se calcula</h3>
        <p><strong>1. Área de aportación.</strong> El DMQ se dividió en 6.148 subcuencas (una por tramo de río, umbral de 0,5 km²) a partir del DEM Copernicus GLO-30 en ArcGIS Pro (Fill, D8, acumulación, Watershed). Cada subcuenca conoce su tramo receptor; al hacer clic la app localiza la subcuenca y suma todas las que drenan hacia ella.</p>
        <p><strong>2. Morfometría.</strong> Cauce principal = camino más largo aguas arriba por la red; pendiente = desnivel entre su nacimiento y el punto de salida / longitud. Pendiente del terreno y cotas: estadística zonal del DEM.</p>
        <p><strong>3. Cobertura.</strong> ESA WorldCover 2021 (10 m) tabulado por subcuenca. CN por clase según TR-55 (grupo hidrológico C, AMC II) y C racional según Chow, ponderados por área.</p>
        <p><strong>4. Tiempo de concentración.</strong> Kirpich: tc = 0,0195·L^0,77·S^−0,385 (min). Témez: tc = 0,3·(L/S^0,25)^0,76 (h, L en km).</p>
        <p><strong>5. Lluvia.</strong> Lluvia de 2 h por período de retorno (Gumbel a máximos anuales móviles, 12 estaciones FONAG 2020-2026), IDW en el punto. Intensidad para t = tc con relación tipo Sherman, n = {opts.n_idf}. <em>Supuesto a reemplazar cuando se disponga de curvas IDF oficiales.</em></p>
        <p><strong>6. Caudal.</strong> Racional hasta 2,5 km²; racional con reserva (y Témez modificado) hasta 10 km²; SCS triangular (Qp = 0,208·A·Pe/tp, tp = D/2 + 0,6·tc) para cuencas mayores, con tormenta de duración max(tc, 2 h).</p>
        <p className="text-[#1F2A24]/50">Refs: Chow, Maidment &amp; Mays (1988) Applied Hydrology; SCS TR-55 (1986); Témez (1991); Gumbel (1958).</p>
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
        <li>Activa la vista técnica para ver la morfometría completa, las estaciones de lluvia usadas, los tres métodos de cálculo y los supuestos.</li>
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
