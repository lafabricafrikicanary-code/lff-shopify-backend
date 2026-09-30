LFF BACKEND V94 · CATÁLOGO B2B POR CATEGORÍAS Y FAMILIAS
Base: Backend V93

CAMBIOS
- /api/lff/b2b/dashboard intent catalog-search devuelve category y family reales leyendo tags Shopify LFF_CATEGORY: y LFF_FAMILY:.
- El catálogo B2B ya no queda limitado a 40 productos: recorre hasta 4 páginas de 250 productos (máx. 1000) para la vista general y hasta 500 cuando existe búsqueda de texto.
- No se cambia la MATRIX de 754 variantes ni la creación de Draft Orders.
- No hay migración Prisma nueva.

ARCHIVO MODIFICADO
- app/routes/api.lff.b2b.dashboard.jsx

DESPLIEGUE
1. Subir SOLO-SUBIR a la raíz de GitHub, rama v73-postgres.
2. Esperar build/deploy verde en Render.
3. Después subir Theme V101 a Shopify.
