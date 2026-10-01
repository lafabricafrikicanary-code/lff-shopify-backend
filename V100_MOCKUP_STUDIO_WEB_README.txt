LFF BACKEND V100 — MOCKUP STUDIO WEB
Base: Backend V99 Catálogo Storefront Robusto

NUEVO
- /api/lff/admin/mockups (solo sesión Admin):
  * ?mode=manifest -> biblioteca oficial V12, 119 mockups compatibles.
  * ?mode=pack -> paquete binario de plantillas JPG.
- Productos Admin:
  * intent create-auto-mockup-draft: crea producto DRAFT con 754 variantes sin exigir categoría/familia todavía.
  * intent assign-media-batch: vincula de golpe todas las imágenes generadas a Modelo + Color + tallas, consultando las 754 variantes una sola vez.
- Biblioteca basada en app.zip / LFF Mockup Studio V12 aportada por Alejandro.
- Regla mantenida: Brick NO se renombra como Verde botella. Camisa hombre genera 49 mockups; total automático = 119.

SIN MIGRACIÓN PRISMA.
No cambia Arcade, familias, productos existentes ni permisos Admin.
