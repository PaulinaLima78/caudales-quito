"""
Reanudar desde el paso 6 (topologia, atributos, GeoJSON) sin herramientas Advanced.
Requiere que ya existan en HIDRO_DMQ.gdb: tramos, subcuencas, dem_fill, stream_orden.
"""

import os
import arcpy
from arcpy.sa import Raster, Slope, ZonalStatisticsAsTable

CARPETA_SAL = r"C:\Users\Paulina\Desktop\UCE 2026\VINCULACION_ARQ\DMQ_HIDRO_26\HIDRO"
gdb = os.path.join(CARPETA_SAL, "HIDRO_DMQ.gdb")

arcpy.CheckOutExtension("Spatial")
arcpy.env.overwriteOutput = True
arcpy.env.addOutputsToMap = False
arcpy.env.workspace = gdb
arcpy.env.scratchWorkspace = gdb

def log(msg):
    print(msg); arcpy.AddMessage(msg)

def add_field(fc, nombre, tipo):
    if nombre not in [f.name for f in arcpy.ListFields(fc)]:
        arcpy.management.AddField(fc, nombre, tipo)

try:
    mapa = arcpy.mp.ArcGISProject("CURRENT").activeMap
    for lyr in mapa.listLayers():
        try:
            if gdb.lower() in lyr.dataSource.lower():
                mapa.removeLayer(lyr)
        except Exception:
            pass
except Exception:
    mapa = None

fill  = Raster(os.path.join(gdb, "dem_fill"))
orden = Raster(os.path.join(gdb, "stream_orden"))
tramos = os.path.join(gdb, "tramos")
subcuencas = os.path.join(gdb, "subcuencas")
celda = float(arcpy.management.GetRasterProperties(fill, "CELLSIZEX").getOutput(0))
sr = arcpy.Describe(tramos).spatialReference
arcpy.env.snapRaster = fill; arcpy.env.extent = fill; arcpy.env.cellSize = celda

# ---------- 6. Topologia aguas abajo ----------
log("6. Calculando id_abajo...")
for nombre, tipo in (("id_abajo", "LONG"), ("long_m", "DOUBLE"), ("orden", "SHORT")):
    add_field(tramos, nombre, tipo)

inicio, geom = {}, {}
with arcpy.da.SearchCursor(tramos, ["id_tramo", "SHAPE@"]) as cur:
    for tid, shp in cur:
        geom[tid] = shp
        p = shp.firstPoint
        inicio.setdefault((round(p.X / celda), round(p.Y / celda)), []).append(tid)

def receptor(tid):
    p = geom[tid].lastPoint
    kx, ky = round(p.X / celda), round(p.Y / celda)
    for dx in (0, -1, 1):
        for dy in (0, -1, 1):
            for cand in inicio.get((kx + dx, ky + dy), []):
                if cand != tid:
                    return cand
    return -1

# Puntos de inicio y fin creados con cursores (sin FeatureVerticesToPoints)
def crear_puntos(nombre, extremo):
    fc = os.path.join(gdb, nombre)
    arcpy.management.CreateFeatureclass(gdb, nombre, "POINT", spatial_reference=sr)
    arcpy.management.AddField(fc, "id_tramo", "LONG")
    with arcpy.da.InsertCursor(fc, ["id_tramo", "SHAPE@XY"]) as ins:
        for tid, shp in geom.items():
            p = shp.firstPoint if extremo == "START" else shp.lastPoint
            ins.insertRow((tid, (p.X, p.Y)))
    return fc

puntos_ini = crear_puntos("tramos_ini", "START")
puntos_fin = crear_puntos("tramos_fin", "END")
arcpy.sa.ExtractMultiValuesToPoints(puntos_fin, [[orden, "orden_r"], [fill, "z_fin"]])
arcpy.sa.ExtractMultiValuesToPoints(puntos_ini, [[fill, "z_ini"]])
orden_t = {r[0]: r[1] for r in arcpy.da.SearchCursor(puntos_fin, ["id_tramo", "orden_r"])}
zfin = {r[0]: r[1] for r in arcpy.da.SearchCursor(puntos_fin, ["id_tramo", "z_fin"])}
zini = {r[0]: r[1] for r in arcpy.da.SearchCursor(puntos_ini, ["id_tramo", "z_ini"])}

sin_receptor = 0
with arcpy.da.UpdateCursor(tramos, ["id_tramo", "id_abajo", "long_m", "orden", "SHAPE@LENGTH"]) as cur:
    for row in cur:
        tid = row[0]
        row[1] = receptor(tid); row[2] = row[4]; row[3] = orden_t.get(tid)
        if row[1] == -1:
            sin_receptor += 1
        cur.updateRow(row)
log(f"   Tramos: {len(geom)}  |  salidas (sin receptor): {sin_receptor}")

# ---------- 7. Atributos por subcuenca ----------
log("7. Zonal statistics...")
pend = Slope(fill, "PERCENT_RISE"); pend.save(os.path.join(gdb, "pendiente_pct"))
tab_z = os.path.join(gdb, "zs_elev"); tab_s = os.path.join(gdb, "zs_pend")
ZonalStatisticsAsTable(subcuencas, "id_tramo", fill, tab_z, "DATA", "MIN_MAX_MEAN")
ZonalStatisticsAsTable(subcuencas, "id_tramo", pend, tab_s, "DATA", "MEAN")
z_stats = {r[0]: r[1:] for r in arcpy.da.SearchCursor(tab_z, ["id_tramo", "MIN", "MAX", "MEAN"])}
s_stats = {r[0]: r[1] for r in arcpy.da.SearchCursor(tab_s, ["id_tramo", "MEAN"])}
t_stats = {r[0]: r[1:] for r in arcpy.da.SearchCursor(tramos, ["id_tramo", "id_abajo", "long_m", "orden"])}

campos = [("id_abajo", "LONG"), ("area_km2", "DOUBLE"), ("long_m", "DOUBLE"), ("orden", "SHORT"),
          ("z_min", "DOUBLE"), ("z_max", "DOUBLE"), ("z_med", "DOUBLE"), ("pend_pct", "DOUBLE"),
          ("z_ini_cauce", "DOUBLE"), ("z_fin_cauce", "DOUBLE"), ("s_cauce", "DOUBLE")]
for nombre, tipo in campos:
    add_field(subcuencas, nombre, tipo)

with arcpy.da.UpdateCursor(subcuencas, ["id_tramo", "SHAPE@AREA"] + [c[0] for c in campos]) as cur:
    for row in cur:
        tid, area = row[0], row[1]
        id_abajo, long_m, ordn = t_stats.get(tid, (-1, None, None))
        zmin, zmax, zmed = z_stats.get(tid, (None, None, None))
        zi, zf = zini.get(tid), zfin.get(tid)
        s_c = (zi - zf) / long_m if (zi is not None and zf is not None and long_m) else None
        row[2:] = [id_abajo, area / 1e6, long_m, ordn, zmin, zmax, zmed, s_stats.get(tid), zi, zf, s_c]
        cur.updateRow(row)

# ---------- 8. GeoJSON ----------
log("8. Exportando GeoJSON...")
web = os.path.join(CARPETA_SAL, "web"); os.makedirs(web, exist_ok=True)
arcpy.conversion.FeaturesToJSON(subcuencas, os.path.join(web, "subcuencas.geojson"),
                                "NOT_FORMATTED", "NO_Z_VALUES", "NO_M_VALUES", "GEOJSON", "WGS84")
arcpy.conversion.FeaturesToJSON(tramos, os.path.join(web, "tramos.geojson"),
                                "NOT_FORMATTED", "NO_Z_VALUES", "NO_M_VALUES", "GEOJSON", "WGS84")

# ---------- 9. Resumen ----------
areas = [r[0] for r in arcpy.da.SearchCursor(subcuencas, ["area_km2"])]
log("\n=== Resumen ===")
log(f"  Subcuencas: {len(areas)} | media {sum(areas)/len(areas):.2f} km2 | min {min(areas):.3f} | max {max(areas):.2f}")
log(f"  GeoJSON en: {web}")
for f in ("subcuencas.geojson", "tramos.geojson"):
    log(f"    {f}: {os.path.getsize(os.path.join(web, f))/1e6:.1f} MB")

if mapa:
    mapa.addDataFromPath(subcuencas); mapa.addDataFromPath(tramos)
arcpy.CheckInExtension("Spatial")
