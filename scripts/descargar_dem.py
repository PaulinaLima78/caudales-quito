"""
Descarga del DEM Copernicus GLO-30 para el AOI del DMQ y mosaico
-----------------------------------------------------------------
Baja los 4 tiles de 1x1 grado que cubren 79W-78W / 1S-1N desde el bucket
publico de AWS (sin registro) y los une en un solo GeoTIFF:
  ...\DMQ_HIDRO_26\DEM\dem_dmq.tif   <- la ruta que espera hidro_dmq.py

Correr en la ventana Python de ArcGIS Pro (usa urllib + arcpy).
"""

import os
import urllib.request
import arcpy

CARPETA_DEM = r"C:\Users\Paulina\Desktop\UCE 2026\VINCULACION_ARQ\DMQ_HIDRO_26\DEM"
SALIDA      = "dem_dmq.tif"
BUCKET      = "https://copernicus-dem-30m.s3.amazonaws.com"

# Tiles nombrados por su esquina SW: N00_W079 cubre lon -79..-78, lat 0..1
TILES = ["N00_00_W079_00", "S01_00_W079_00", "N00_00_W080_00", "S01_00_W080_00"]

os.makedirs(CARPETA_DEM, exist_ok=True)
arcpy.env.overwriteOutput = True

descargados = []
for t in TILES:
    nombre = f"Copernicus_DSM_COG_10_{t}_DEM"
    url = f"{BUCKET}/{nombre}/{nombre}.tif"
    destino = os.path.join(CARPETA_DEM, f"{nombre}.tif")
    if os.path.exists(destino) and os.path.getsize(destino) > 1_000_000:
        print(f"Ya existe: {nombre}.tif")
        descargados.append(destino)
        continue
    print(f"Descargando {nombre}.tif ...")
    try:
        urllib.request.urlretrieve(url, destino)
        print(f"   OK  {os.path.getsize(destino)/1e6:.1f} MB")
        descargados.append(destino)
    except Exception as e:
        print(f"   ERROR: {e}")

if not descargados:
    raise SystemExit("No se descargo ningun tile. Revisa la conexion o el proxy de la UCE.")

print("\nMosaicando...")
arcpy.management.MosaicToNewRaster(
    input_rasters=descargados,
    output_location=CARPETA_DEM,
    raster_dataset_name_with_extension=SALIDA,
    coordinate_system_for_the_raster=arcpy.SpatialReference(4326),
    pixel_type="32_BIT_FLOAT",
    number_of_bands=1,
    mosaic_method="FIRST",
)
dem = os.path.join(CARPETA_DEM, SALIDA)
d = arcpy.Describe(dem)
print(f"DEM listo: {dem}")
print(f"  {d.width} x {d.height} celdas, {d.spatialReference.name}")
print(f"  Extent lon {d.extent.XMin:.2f}..{d.extent.XMax:.2f}  lat {d.extent.YMin:.2f}..{d.extent.YMax:.2f}")

try:
    arcpy.mp.ArcGISProject("CURRENT").activeMap.addDataFromPath(dem)
except Exception:
    pass
