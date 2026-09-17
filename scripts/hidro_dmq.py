"""
Preprocesamiento hidrologico del DMQ (ArcGIS Pro + Spatial Analyst)
-------------------------------------------------------------------
Entrada : DEM + AOI (de aoi_dmq.py)
Salida  : red de drenaje por tramos y una subcuenca por tramo, con
          topologia aguas abajo y atributos geomorfologicos, en GDB y GeoJSON.

Flujo:
  DEM -> recorte AOI -> (remuestreo) -> Fill -> FlowDir D8 -> FlowAcc
      -> red (umbral km2) -> StreamLink -> Strahler -> Watershed por tramo
      -> poligonos + lineas -> topologia (id_abajo) -> atributos -> GeoJSON

El GeoJSON se convierte despues a TopoJSON con mapshaper:
  mapshaper subcuencas.geojson -simplify 8% keep-shapes -o subcuencas.json format=topojson
"""

import os
import math
import arcpy
from arcpy.sa import (ExtractByMask, Fill, FlowDirection, FlowAccumulation, Con,
                      StreamLink, StreamOrder, Watershed, Slope, ZonalStatisticsAsTable)

# ---------------- Parametros ----------------
DEM_ENTRADA   = r"C:\Users\Paulina\Desktop\UCE 2026\VINCULACION_ARQ\DMQ_HIDRO_26\DEM\dem_dmq.tif"   # <-- ajusta
GDB_AOI       = r"C:\Users\Paulina\Desktop\UCE 2026\VINCULACION_ARQ\DMQ_HIDRO_26\AOI\AOI_DMQ.gdb"
AOI_MASCARA   = os.path.join(GDB_AOI, "DMQ_AOI_buffer5km")      # o DMQ_AOI_rect5km
CARPETA_SAL   = r"C:\Users\Paulina\Desktop\UCE 2026\VINCULACION_ARQ\DMQ_HIDRO_26\HIDRO"
GDB_NOMBRE    = "HIDRO_DMQ.gdb"
EPSG_TRABAJO  = 32717          # WGS84 / UTM 17S, igual que el AOI
TAMANO_CELDA  = 30             # m. None = usar el del DEM. Con DEM IGM de 3-4 m, 10 m es buen compromiso
UMBRAL_KM2    = 0.5            # area minima de aportacion para iniciar un cauce (define tamano de subcuencas)
# --------------------------------------------

arcpy.CheckOutExtension("Spatial")
arcpy.env.overwriteOutput = True
os.makedirs(CARPETA_SAL, exist_ok=True)
gdb = os.path.join(CARPETA_SAL, GDB_NOMBRE)
if not arcpy.Exists(gdb):
    arcpy.management.CreateFileGDB(CARPETA_SAL, GDB_NOMBRE)
arcpy.env.workspace = gdb
arcpy.env.scratchWorkspace = gdb
sr = arcpy.SpatialReference(EPSG_TRABAJO)

def log(msg):
    print(msg); arcpy.AddMessage(msg)

# ---------- 1. DEM: proyectar, recortar, remuestrear ----------
log("1. Preparando DEM...")
dem_desc = arcpy.Describe(DEM_ENTRADA)
dem_src = DEM_ENTRADA
if dem_desc.spatialReference.factoryCode != EPSG_TRABAJO:
    dem_src = os.path.join(gdb, "dem_utm")
    celda = TAMANO_CELDA or dem_desc.meanCellWidth
    arcpy.management.ProjectRaster(DEM_ENTRADA, dem_src, sr, "BILINEAR", celda)
elif TAMANO_CELDA and abs(dem_desc.meanCellWidth - TAMANO_CELDA) > 0.01:
    dem_src = os.path.join(gdb, "dem_resamp")
    arcpy.management.Resample(DEM_ENTRADA, dem_src, TAMANO_CELDA, "BILINEAR")

dem = ExtractByMask(dem_src, AOI_MASCARA)
dem.save(os.path.join(gdb, "dem_aoi"))
celda = float(arcpy.management.GetRasterProperties(dem, "CELLSIZEX").getOutput(0))
arcpy.env.snapRaster = dem
arcpy.env.extent = dem
arcpy.env.cellSize = celda
log(f"   Celda de trabajo: {celda:.2f} m")

# ---------- 2. Hidrologia base ----------
log("2. Fill / Flow Direction / Flow Accumulation...")
fill = Fill(dem);                         fill.save("dem_fill")
fdir = FlowDirection(fill, "NORMAL");     fdir.save("flowdir")
facc = FlowAccumulation(fdir, None, "FLOAT", "D8"); facc.save("flowacc")

# ---------- 3. Red de drenaje y tramos ----------
umbral_celdas = int(UMBRAL_KM2 * 1e6 / (celda * celda))
log(f"3. Red de drenaje con umbral {UMBRAL_KM2} km2 = {umbral_celdas} celdas")
red   = Con(facc >= umbral_celdas, 1);   red.save("red_raster")
link  = StreamLink(red, fdir);           link.save("stream_link")
orden = StreamOrder(red, fdir, "STRAHLER"); orden.save("stream_orden")

# ---------- 4. Subcuenca por tramo ----------
log("4. Watershed por tramo...")
wsh = Watershed(fdir, link, "VALUE");    wsh.save("subcuencas_raster")

# ---------- 5. A vectores ----------
log("5. Convirtiendo a vectores...")
tramos_raw = os.path.join(gdb, "tramos_raw")
arcpy.sa.StreamToFeature(link, fdir, tramos_raw, "NO_SIMPLIFY")   # lineas orientadas aguas abajo
sub_raw = os.path.join(gdb, "subcuencas_raw")
arcpy.conversion.RasterToPolygon(wsh, sub_raw, "NO_SIMPLIFY", "VALUE")
subcuencas = os.path.join(gdb, "subcuencas")
arcpy.management.Dissolve(sub_raw, subcuencas, "gridcode")   # una entidad por tramo
tramos = os.path.join(gdb, "tramos")
arcpy.management.Dissolve(tramos_raw, tramos, "grid_code")

for fc in (subcuencas, tramos):
    campo_orig = "gridcode" if fc == subcuencas else "grid_code"
    arcpy.management.AddField(fc, "id_tramo", "LONG")
    arcpy.management.CalculateField(fc, "id_tramo", f"!{campo_orig}!", "PYTHON3")
    arcpy.management.DeleteField(fc, campo_orig)

# ---------- 6. Topologia aguas abajo ----------
log("6. Calculando id_abajo (tramo receptor)...")
arcpy.management.AddField(tramos, "id_abajo", "LONG")
arcpy.management.AddField(tramos, "long_m", "DOUBLE")
arcpy.management.AddField(tramos, "orden", "SHORT")

inicio = {}   # (x,y) redondeado del primer vertice -> id_tramo
geom = {}
with arcpy.da.SearchCursor(tramos, ["id_tramo", "SHAPE@"]) as cur:
    for tid, shp in cur:
        geom[tid] = shp
        p = shp.firstPoint
        inicio.setdefault((round(p.X / celda), round(p.Y / celda)), []).append(tid)

def receptor(tid):
    """Tramo cuyo primer vertice coincide con el ultimo vertice de tid."""
    p = geom[tid].lastPoint
    kx, ky = round(p.X / celda), round(p.Y / celda)
    for dx in (0, -1, 1):
        for dy in (0, -1, 1):
            for cand in inicio.get((kx + dx, ky + dy), []):
                if cand != tid:
                    return cand
    return -1   # salida del AOI

# Strahler por tramo: valor del raster en el ultimo vertice
orden_tab = os.path.join(gdb, "orden_tab")
puntos_fin = os.path.join(gdb, "tramos_fin")
arcpy.management.FeatureVerticesToPoints(tramos, puntos_fin, "END")
arcpy.sa.ExtractMultiValuesToPoints(puntos_fin, [[orden, "orden_r"], [fill, "z_fin"]])
puntos_ini = os.path.join(gdb, "tramos_ini")
arcpy.management.FeatureVerticesToPoints(tramos, puntos_ini, "START")
arcpy.sa.ExtractMultiValuesToPoints(puntos_ini, [[fill, "z_ini"]])
orden_por_tramo = {r[0]: r[1] for r in arcpy.da.SearchCursor(puntos_fin, ["id_tramo", "orden_r"])}
zfin = {r[0]: r[1] for r in arcpy.da.SearchCursor(puntos_fin, ["id_tramo", "z_fin"])}
zini = {r[0]: r[1] for r in arcpy.da.SearchCursor(puntos_ini, ["id_tramo", "z_ini"])}

sin_receptor = 0
with arcpy.da.UpdateCursor(tramos, ["id_tramo", "id_abajo", "long_m", "orden", "SHAPE@LENGTH"]) as cur:
    for row in cur:
        tid = row[0]
        row[1] = receptor(tid)
        row[2] = row[4]
        row[3] = orden_por_tramo.get(tid)
        if row[1] == -1:
            sin_receptor += 1
        cur.updateRow(row)
log(f"   Tramos: {len(geom)}  |  salidas (sin receptor): {sin_receptor}")

# ---------- 7. Atributos geomorfologicos por subcuenca ----------
log("7. Zonal statistics (elevacion y pendiente)...")
pend = Slope(fill, "PERCENT_RISE"); pend.save("pendiente_pct")
tab_z = os.path.join(gdb, "zs_elev")
tab_s = os.path.join(gdb, "zs_pend")
ZonalStatisticsAsTable(subcuencas, "id_tramo", fill, tab_z, "DATA", "MIN_MAX_MEAN")
ZonalStatisticsAsTable(subcuencas, "id_tramo", pend, tab_s, "DATA", "MEAN")

z_stats = {r[0]: r[1:] for r in arcpy.da.SearchCursor(tab_z, ["id_tramo", "MIN", "MAX", "MEAN"])}
s_stats = {r[0]: r[1] for r in arcpy.da.SearchCursor(tab_s, ["id_tramo", "MEAN"])}
t_stats = {r[0]: r[1:] for r in arcpy.da.SearchCursor(tramos, ["id_tramo", "id_abajo", "long_m", "orden"])}

campos = [("id_abajo", "LONG"), ("area_km2", "DOUBLE"), ("long_m", "DOUBLE"),
          ("orden", "SHORT"), ("z_min", "DOUBLE"), ("z_max", "DOUBLE"), ("z_med", "DOUBLE"),
          ("pend_pct", "DOUBLE"), ("z_ini_cauce", "DOUBLE"), ("z_fin_cauce", "DOUBLE"),
          ("s_cauce", "DOUBLE")]
for nombre, tipo in campos:
    arcpy.management.AddField(subcuencas, nombre, tipo)

with arcpy.da.UpdateCursor(subcuencas, ["id_tramo", "SHAPE@AREA"] + [c[0] for c in campos]) as cur:
    for row in cur:
        tid, area = row[0], row[1]
        id_abajo, long_m, orden_t = t_stats.get(tid, (-1, None, None))
        zmin, zmax, zmed = z_stats.get(tid, (None, None, None))
        zi, zf = zini.get(tid), zfin.get(tid)
        s_c = (zi - zf) / long_m if (zi is not None and zf is not None and long_m) else None
        row[2:] = [id_abajo, area / 1e6, long_m, orden_t, zmin, zmax, zmed,
                   s_stats.get(tid), zi, zf, s_c]
        cur.updateRow(row)

# ---------- 8. Exportar GeoJSON (WGS84) para la app ----------
log("8. Exportando GeoJSON...")
carpeta_web = os.path.join(CARPETA_SAL, "web")
os.makedirs(carpeta_web, exist_ok=True)
arcpy.conversion.FeaturesToJSON(subcuencas, os.path.join(carpeta_web, "subcuencas.geojson"),
                                "NOT_FORMATTED", "NO_Z_VALUES", "NO_M_VALUES", "GEOJSON", "WGS84")
arcpy.conversion.FeaturesToJSON(tramos, os.path.join(carpeta_web, "tramos.geojson"),
                                "NOT_FORMATTED", "NO_Z_VALUES", "NO_M_VALUES", "GEOJSON", "WGS84")

# ---------- 9. Resumen ----------
areas = [r[0] for r in arcpy.da.SearchCursor(subcuencas, ["area_km2"])]
log("\n=== Resumen ===")
log(f"  Subcuencas: {len(areas)}  |  area media {sum(areas)/len(areas):.2f} km2  |  "
    f"min {min(areas):.3f}  max {max(areas):.2f}")
log(f"  GDB: {gdb}")
log(f"  GeoJSON: {carpeta_web}")

try:
    mapa = arcpy.mp.ArcGISProject("CURRENT").activeMap
    mapa.addDataFromPath(subcuencas); mapa.addDataFromPath(tramos)
except Exception:
    pass
arcpy.CheckInExtension("Spatial")
