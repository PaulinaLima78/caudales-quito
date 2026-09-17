"""
AOI del DMQ para el estudio hidrologico
---------------------------------------
Genera, a partir del shape de administraciones zonales:
  1. DMQ_limite        : disuelve todas las zonas en un solo poligono
  2. DMQ_AOI_buffer5km : el limite ampliado 5 km hacia afuera
  3. DMQ_AOI_rect5km   : rectangulo (extent) de ese buffer, util para recortar DEM/rasters

Correr desde la ventana Python de ArcGIS Pro o como script de una Toolbox.
"""

import os
import arcpy

# ---------------- Parametros ----------------
SHP_ZONAS = r"C:\Users\Paulina\Desktop\UCE 2026\VINCULACION_ARQ\DMQ_HIDRO_26\adm_zonal_a\202508_Limites_Administraciones_Zonales\organizacion_territorial_zonal_a.shp"
CARPETA_SALIDA = r"C:\Users\Paulina\Desktop\UCE 2026\VINCULACION_ARQ\DMQ_HIDRO_26\AOI"
GDB_NOMBRE = "AOI_DMQ.gdb"
HOLGURA = "5 Kilometers"
EPSG_TRABAJO = 32717   # WGS 84 / UTM 17S. Cambia a 32717->31997 etc. si tu proyecto usa otro sistema
# --------------------------------------------

arcpy.env.overwriteOutput = True

# 1. Geodatabase de salida
os.makedirs(CARPETA_SALIDA, exist_ok=True)
gdb = os.path.join(CARPETA_SALIDA, GDB_NOMBRE)
if not arcpy.Exists(gdb):
    arcpy.management.CreateFileGDB(CARPETA_SALIDA, GDB_NOMBRE)
arcpy.env.workspace = gdb

# 2. Asegurar sistema proyectado (el buffer en km necesita metros)
sr = arcpy.Describe(SHP_ZONAS).spatialReference
print(f"Sistema del shape: {sr.name} ({sr.type})")
if sr.type == "Geographic":
    zonas = os.path.join(gdb, "zonas_utm")
    arcpy.management.Project(SHP_ZONAS, zonas, arcpy.SpatialReference(EPSG_TRABAJO))
    print(f"Proyectado a EPSG:{EPSG_TRABAJO}")
else:
    zonas = SHP_ZONAS

# 3. Disolver todas las administraciones zonales en un solo poligono
limite = os.path.join(gdb, "DMQ_limite")
arcpy.management.Dissolve(zonas, limite)

# 4. Buffer de 5 km hacia afuera (dissolve para que quede una sola pieza)
aoi_buffer = os.path.join(gdb, "DMQ_AOI_buffer5km")
arcpy.analysis.Buffer(limite, aoi_buffer, HOLGURA, "FULL", "ROUND", "ALL")

# 5. Rectangulo envolvente del buffer (para Extract by Mask / clip de rasters)
aoi_rect = os.path.join(gdb, "DMQ_AOI_rect5km")
arcpy.management.MinimumBoundingGeometry(aoi_buffer, aoi_rect, "ENVELOPE", "ALL")

# 6. Reporte
ext_lim = arcpy.Describe(limite).extent
ext_aoi = arcpy.Describe(aoi_rect).extent
area_lim = sum(r[0] for r in arcpy.da.SearchCursor(limite, ["SHAPE@AREA"])) / 1e6
area_aoi = sum(r[0] for r in arcpy.da.SearchCursor(aoi_buffer, ["SHAPE@AREA"])) / 1e6

print("\n=== Limite DMQ (disuelto) ===")
print(f"  Area: {area_lim:,.1f} km2")
print(f"  XMin {ext_lim.XMin:,.1f}  YMin {ext_lim.YMin:,.1f}  XMax {ext_lim.XMax:,.1f}  YMax {ext_lim.YMax:,.1f}")
print("\n=== AOI con 5 km de holgura ===")
print(f"  Area del buffer: {area_aoi:,.1f} km2")
print(f"  XMin {ext_aoi.XMin:,.1f}  YMin {ext_aoi.YMin:,.1f}  XMax {ext_aoi.XMax:,.1f}  YMax {ext_aoi.YMax:,.1f}")
print(f"  Ancho {ext_aoi.width/1000:,.1f} km  x  Alto {ext_aoi.height/1000:,.1f} km")
print(f"\nSalidas en: {gdb}")

# 7. Agregar al mapa activo (solo si se corre dentro de ArcGIS Pro)
try:
    aprx = arcpy.mp.ArcGISProject("CURRENT")
    mapa = aprx.activeMap
    for capa in (aoi_rect, aoi_buffer, limite):
        mapa.addDataFromPath(capa)
    print("Capas agregadas al mapa activo.")
except Exception:
    pass
