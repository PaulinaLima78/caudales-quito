"""
Uso de suelo por subcuenca (ESA WorldCover 10 m, 2021 v200) -> CN (SCS) y C (racional)
--------------------------------------------------------------------------------------
1. Descarga los 2 tiles de WorldCover que cubren el AOI desde el bucket publico de AWS
2. Mosaico, proyeccion a UTM 17S y recorte al AOI
3. Tabulate Area por subcuenca (id_tramo)
4. CN y C ponderados por area, usando el grupo hidrologico de suelo elegido
5. Exporta HIDRO\\web\\uso_suelo.csv para unirlo al TopoJSON con mapshaper:

   mapshaper subcuencas.json -join uso_suelo.csv keys=id_tramo,id_tramo -o force subcuencas.json
"""

import os
import csv
import urllib.request
import arcpy
from arcpy.sa import ExtractByMask, TabulateArea

# ---------------- Parametros ----------------
BASE        = r"C:\Users\Paulina\Desktop\UCE 2026\VINCULACION_ARQ\DMQ_HIDRO_26"
CARPETA_LC  = os.path.join(BASE, "USO_SUELO")
GDB_AOI     = os.path.join(BASE, "AOI", "AOI_DMQ.gdb")
GDB_HIDRO   = os.path.join(BASE, "HIDRO", "HIDRO_DMQ.gdb")
CARPETA_WEB = os.path.join(BASE, "HIDRO", "web")
AOI_MASCARA = os.path.join(GDB_AOI, "DMQ_AOI_buffer5km")
SUBCUENCAS  = os.path.join(GDB_HIDRO, "subcuencas")
EPSG        = 32717
CELDA_M     = 10
GRUPO_SUELO = "C"   # grupo hidrologico SCS por defecto para Quito: suelos volcanicos / cangahua -> B o C
BUCKET      = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map"
TILES       = ["S03W081", "N00W081"]
# --------------------------------------------

# Clases WorldCover -> CN (AMC II) por grupo hidrologico (A,B,C,D) y C racional.
# Ref: SCS TR-55 (1986); Chow, Maidment & Mays (1988); adaptado a clases WorldCover.
CLASES = {
    10:  ("bosque",       {"A": 36, "B": 60, "C": 73, "D": 79}, 0.30),
    20:  ("matorral",     {"A": 35, "B": 56, "C": 70, "D": 77}, 0.35),
    30:  ("pastizal",     {"A": 39, "B": 61, "C": 74, "D": 80}, 0.35),   # paramo / pasto
    40:  ("cultivo",      {"A": 62, "B": 72, "C": 81, "D": 86}, 0.45),
    50:  ("urbano",       {"A": 77, "B": 85, "C": 90, "D": 92}, 0.75),   # residencial ~65% impermeable
    60:  ("suelo_desnudo",{"A": 77, "B": 86, "C": 91, "D": 94}, 0.60),
    70:  ("nieve",        {"A": 98, "B": 98, "C": 98, "D": 98}, 0.90),
    80:  ("agua",         {"A": 100,"B": 100,"C": 100,"D": 100}, 1.00),
    90:  ("humedal",      {"A": 60, "B": 80, "C": 85, "D": 88}, 0.50),
    95:  ("manglar",      {"A": 60, "B": 80, "C": 85, "D": 88}, 0.50),
    100: ("musgo_liquen", {"A": 50, "B": 74, "C": 82, "D": 86}, 0.40),
}
# Grupos agregados que iran al JSON (fracciones 0-1)
GRUPOS = {"urbano": [50], "vegetacion": [10, 20, 30, 90, 95, 100], "cultivo": [40],
          "desnudo": [60, 70], "agua": [80]}

arcpy.CheckOutExtension("Spatial")
arcpy.env.overwriteOutput = True
arcpy.env.addOutputsToMap = False
os.makedirs(CARPETA_LC, exist_ok=True)
os.makedirs(CARPETA_WEB, exist_ok=True)

def log(m):
    print(m); arcpy.AddMessage(m)

# ---------- 1. Descarga ----------
log("1. Descargando WorldCover...")
tifs = []
for t in TILES:
    nombre = f"ESA_WorldCover_10m_2021_v200_{t}_Map.tif"
    destino = os.path.join(CARPETA_LC, nombre)
    if not (os.path.exists(destino) and os.path.getsize(destino) > 1_000_000):
        try:
            urllib.request.urlretrieve(f"{BUCKET}/{nombre}", destino)
            log(f"   OK {nombre} ({os.path.getsize(destino)/1e6:.0f} MB)")
        except Exception as e:
            log(f"   ERROR {nombre}: {e}")
            continue
    else:
        log(f"   Ya existe {nombre}")
    tifs.append(destino)
if not tifs:
    raise SystemExit("Sin tiles. Descarga manual: https://esa-worldcover.org/en/data-access")

# ---------- 2. Mosaico, proyeccion, recorte ----------
log("2. Mosaico y proyeccion...")
mosaico = os.path.join(CARPETA_LC, "worldcover_mosaico.tif")
arcpy.management.MosaicToNewRaster(
    input_rasters=tifs,
    output_location=CARPETA_LC,
    raster_dataset_name_with_extension="worldcover_mosaico.tif",
    coordinate_system_for_the_raster=arcpy.SpatialReference(4326),
    pixel_type="8_BIT_UNSIGNED",
    number_of_bands=1,
    mosaic_method="FIRST",
)
lc_utm = os.path.join(GDB_HIDRO, "worldcover_utm")
arcpy.management.ProjectRaster(mosaico, lc_utm, arcpy.SpatialReference(EPSG), "NEAREST", CELDA_M)
lc = ExtractByMask(lc_utm, AOI_MASCARA)
lc.save(os.path.join(GDB_HIDRO, "worldcover_aoi"))

# ---------- 3. Tabulate Area ----------
log("3. Tabulate Area por subcuenca (puede tardar varios minutos)...")
tabla = os.path.join(GDB_HIDRO, "tab_uso_suelo")
arcpy.env.cellSize = CELDA_M
TabulateArea(SUBCUENCAS, "id_tramo", lc, "VALUE", tabla, CELDA_M)

# ---------- 4. CN y C ponderados ----------
log("4. Calculando CN y C...")
campos = [f.name for f in arcpy.ListFields(tabla) if f.name.upper().startswith("VALUE_")]
clase_de_campo = {c: int(c.split("_")[1]) for c in campos}

filas = []
with arcpy.da.SearchCursor(tabla, ["id_tramo"] + campos) as cur:
    for r in cur:
        tid = r[0]
        areas = {clase_de_campo[c]: (r[i + 1] or 0.0) for i, c in enumerate(campos)}
        total = sum(areas.values())
        if total <= 0:
            continue
        cn = sum(areas[k] * CLASES[k][1][GRUPO_SUELO] for k in areas if k in CLASES) / total
        c_r = sum(areas[k] * CLASES[k][2] for k in areas if k in CLASES) / total
        fila = {"id_tramo": tid, "cn": round(cn, 1), "c_rac": round(c_r, 3)}
        for g, clases in GRUPOS.items():
            fila[f"f_{g}"] = round(sum(areas.get(k, 0.0) for k in clases) / total, 3)
        filas.append(fila)

# ---------- 5. CSV ----------
salida = os.path.join(CARPETA_WEB, "uso_suelo.csv")
cols = ["id_tramo", "cn", "c_rac"] + [f"f_{g}" for g in GRUPOS]
with open(salida, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader(); w.writerows(filas)

# Tambien a la feature class, por si lo quieres ver en el mapa
for c in cols[1:]:
    if c not in [f.name for f in arcpy.ListFields(SUBCUENCAS)]:
        arcpy.management.AddField(SUBCUENCAS, c, "DOUBLE")
por_id = {f["id_tramo"]: f for f in filas}
with arcpy.da.UpdateCursor(SUBCUENCAS, ["id_tramo"] + cols[1:]) as cur:
    for row in cur:
        d = por_id.get(row[0])
        if d:
            row[1:] = [d[c] for c in cols[1:]]
            cur.updateRow(row)

cns = [f["cn"] for f in filas]
urb = sum(f["f_urbano"] for f in filas) / len(filas)
log("\n=== Resumen ===")
log(f"  Subcuencas con uso de suelo: {len(filas)}")
log(f"  CN medio (grupo {GRUPO_SUELO}): {sum(cns)/len(cns):.1f}  |  min {min(cns):.0f}  max {max(cns):.0f}")
log(f"  Fraccion urbana media: {urb*100:.1f}%")
log(f"  CSV: {salida}")
arcpy.CheckInExtension("Spatial")
