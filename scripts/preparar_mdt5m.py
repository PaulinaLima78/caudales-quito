r"""
Preparar el MDT de 5 m del DMQ para hidro_dmq.py
------------------------------------------------
Entrada : el zip descargado de la carpeta "Qgis" de Drive, que trae
            mdt_dmq_5m.zip  y  mdt_urbano_y_fuente.zip
Salida  : ...\DMQ_HIDRO_26\DEM\dem_dmq_5m.tif   <- la ruta que espera hidro_dmq.py

Pasos:
  1. Descomprime el zip exterior y los zips interiores (cada uno en su carpeta)
  2. Busca todos los rasters (tif, img, asc, grids ESRI, rasters en gdb) y
     reporta sistema de coordenadas, celda, extension y rango de cotas.
     REVISA ESTE REPORTE antes de seguir: el MDT del Municipio suele venir en
     TM-Quito (SIRES-DMQ), no en UTM 17S; aqui se reproyecta a EPSG:32717.
  3. Reproyecta cada raster a UTM 17S con celda de 5 m alineada a una misma grilla
  4. Rellena lo que el MDT no cubre (parte del buffer de 5 km fuera del DMQ) con el
     Copernicus GLO-30 remuestreado a 5 m, corrigiendo el desfase vertical medio
     entre ambos en la zona de traslape (para no crear escalones en la costura).
     Prioridad del mosaico: raster mas fino primero, Copernicus al final.
  5. Escribe dem_dmq_5m.tif y un resumen

Correr en la ventana Python de ArcGIS Pro (Spatial Analyst).
"""

import os
import zipfile
import arcpy
from arcpy.sa import Raster, Con, IsNull, ExtractByMask

# ---------------- Parametros ----------------
BASE        = r"C:\Users\Paulina\Desktop\UCE 2026\VINCULACION_ARQ\DMQ_HIDRO_26"
ZIP_QGIS    = r"C:\Users\Paulina\Downloads\Qgis-20261015T002545Z-1-001.zip"
CARPETA_DEM = os.path.join(BASE, "DEM")
CARPETA_MDT = os.path.join(CARPETA_DEM, "MDT_5m")          # aqui se descomprime todo
DEM_30M     = os.path.join(CARPETA_DEM, "dem_dmq.tif")      # Copernicus de descargar_dem.py
AOI_MASCARA = os.path.join(BASE, "AOI", "AOI_DMQ.gdb", "DMQ_AOI_buffer5km")
SALIDA      = os.path.join(CARPETA_DEM, "dem_dmq_5m.tif")
EPSG        = 32717
CELDA       = 5
RELLENAR_CON_30M = True     # False = solo el MDT de 5 m (lo que quede fuera queda sin datos)
# --------------------------------------------

arcpy.CheckOutExtension("Spatial")
arcpy.env.overwriteOutput = True
arcpy.env.addOutputsToMap = False
sr = arcpy.SpatialReference(EPSG)

def log(msg):
    print(msg); arcpy.AddMessage(msg)

# ---------- 1. Descomprimir ----------
log("1. Descomprimiendo...")
os.makedirs(CARPETA_MDT, exist_ok=True)

def descomprimir(zip_path, destino):
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(destino)
    log(f"   {os.path.basename(zip_path)} -> {destino}")
    # zips dentro del zip (mdt_dmq_5m.zip, mdt_urbano_y_fuente.zip)
    for raiz, _, archivos in os.walk(destino):
        for a in archivos:
            if a.lower().endswith(".zip"):
                interior = os.path.join(raiz, a)
                carpeta = os.path.join(raiz, os.path.splitext(a)[0])
                if not os.path.isdir(carpeta):
                    descomprimir(interior, carpeta)

if os.path.exists(ZIP_QGIS):
    descomprimir(ZIP_QGIS, CARPETA_MDT)
else:
    log(f"   No existe {ZIP_QGIS}; uso lo que ya este en {CARPETA_MDT}")

# ---------- 2. Inventario ----------
log("\n2. Rasters encontrados:")
rasters = []
for raiz, _, nombres in arcpy.da.Walk(CARPETA_MDT, datatype="RasterDataset"):
    for n in nombres:
        rasters.append(os.path.join(raiz, n))
if not rasters:
    raise SystemExit(f"No se encontraron rasters en {CARPETA_MDT}. Revisa el contenido de los zip.")

info = []
for r in rasters:
    d = arcpy.Describe(r)
    s = d.spatialReference
    arcpy.management.CalculateStatistics(r)
    zmin = float(arcpy.management.GetRasterProperties(r, "MINIMUM").getOutput(0))
    zmax = float(arcpy.management.GetRasterProperties(r, "MAXIMUM").getOutput(0))
    celda_m = d.meanCellWidth * (111320 if s.type == "Geographic" else 1)
    info.append((celda_m, r))
    log(f"   - {os.path.relpath(r, CARPETA_MDT)}")
    log(f"       SRC: {s.name} (EPSG {s.factoryCode or 'personalizado'})  |  celda {celda_m:.2f} m"
        f"  |  {d.width} x {d.height}  |  z {zmin:.0f} .. {zmax:.0f} m  |  {d.pixelType}")
    if s.name in ("Unknown", ""):
        log("       !! Sin sistema de coordenadas. Definelo con Define Projection antes de seguir"
            " (el MDT del Municipio normalmente es TM-Quito / SIRES-DMQ).")
    if zmin < 0 or zmax > 7000:
        log("       !! Rango de cotas raro: revisa el valor NoData o si es un raster de otra cosa.")
info.sort()   # mas fino primero = prioridad en el mosaico

# ---------- 3. Reproyectar a UTM 17S, 5 m, misma grilla ----------
log("\n3. Reproyectando a EPSG:%d con celda %s m..." % (EPSG, CELDA))
gdb_tmp = os.path.join(CARPETA_DEM, "mdt_tmp.gdb")
if not arcpy.Exists(gdb_tmp):
    arcpy.management.CreateFileGDB(CARPETA_DEM, "mdt_tmp.gdb")
arcpy.env.outputCoordinateSystem = sr
arcpy.env.cellSize = CELDA
arcpy.env.extent = AOI_MASCARA

proyectados = []
for i, (_, r) in enumerate(info):
    destino = os.path.join(gdb_tmp, f"mdt_{i}")
    if proyectados:
        arcpy.env.snapRaster = proyectados[0]
    arcpy.management.ProjectRaster(r, destino, sr, "BILINEAR", CELDA)
    proyectados.append(destino)
    log(f"   {os.path.basename(r)} -> {destino}")
arcpy.env.snapRaster = proyectados[0]

# Mosaico de los MDT finos (el primero de la lista manda donde se superponen)
mdt = Raster(proyectados[0])
for p in proyectados[1:]:
    mdt = Con(IsNull(mdt), Raster(p), mdt)

# ---------- 4. Relleno con Copernicus 30 m ----------
if RELLENAR_CON_30M and arcpy.Exists(DEM_30M):
    log("\n4. Rellenando huecos con Copernicus 30 m...")
    cop = os.path.join(gdb_tmp, "cop_5m")
    arcpy.management.ProjectRaster(DEM_30M, cop, sr, "BILINEAR", CELDA)
    cop = Raster(cop)
    dif = mdt - cop                      # solo existe donde hay ambos
    dif.save(os.path.join(gdb_tmp, "dif_mdt_cop"))
    arcpy.management.CalculateStatistics(dif)
    desfase = float(arcpy.management.GetRasterProperties(dif, "MEAN").getOutput(0))
    desv = float(arcpy.management.GetRasterProperties(dif, "STD").getOutput(0))
    log(f"   MDT - Copernicus en el traslape: media {desfase:+.2f} m, desv. {desv:.2f} m")
    log("   (Copernicus es modelo de superficie: en zona urbana/bosque queda unos metros arriba;"
        " se aplica el desfase medio al relleno)")
    dem = Con(IsNull(mdt), cop + desfase, mdt)
else:
    log("\n4. Sin relleno con 30 m")
    dem = mdt

# ---------- 5. Recorte y salida ----------
log("\n5. Recortando al AOI y guardando...")
dem = ExtractByMask(dem, AOI_MASCARA)
arcpy.management.CopyRaster(dem, SALIDA, pixel_type="32_BIT_FLOAT", nodata_value="-9999")
arcpy.management.CalculateStatistics(SALIDA)

d = arcpy.Describe(SALIDA)
log("\n=== DEM listo ===")
log(f"  {SALIDA}")
log(f"  {d.width} x {d.height} celdas de {d.meanCellWidth:.1f} m  ({d.width*d.height/1e6:.0f} millones)")
log(f"  z {arcpy.management.GetRasterProperties(SALIDA, 'MINIMUM').getOutput(0)} .. "
    f"{arcpy.management.GetRasterProperties(SALIDA, 'MAXIMUM').getOutput(0)} m")
log("  Siguiente paso: hidro_dmq.py (DEM_ENTRADA ya apunta a este archivo)")

arcpy.env.outputCoordinateSystem = None
arcpy.env.extent = None
arcpy.env.snapRaster = None
arcpy.env.cellSize = None
try:
    arcpy.mp.ArcGISProject("CURRENT").activeMap.addDataFromPath(SALIDA)
except Exception:
    pass
arcpy.CheckInExtension("Spatial")
