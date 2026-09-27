LFF BACKEND V74 - BOLSA ARCADE SHOPIFY

Cambios principales:
- Mantiene PostgreSQL y AppDistribution.SingleMerchant.
- El Control Center muestra el estado de la bolsa Arcade por porcentaje (5/10/15/20/25/30%).
- Permite crear lotes de codigos reales en Shopify desde el Control Center.
- Usa discountRedeemCodeBulkAdd para añadir hasta 250 codigos a un lote de Shopify.
- Los codigos quedan en PostgreSQL como pending/available/assigned/redeemed/failed.
- Permite sincronizar lotes pendientes con Shopify.
- El canje del storefront prioriza SHOPIFY_SHOP_DOMAIN y no confia en un shop enviado por el cliente.
- El endpoint administrativo de importacion usa SHOPIFY_SHOP_DOMAIN configurado en Render.
- No requiere migracion nueva de base de datos.

Prueba recomendada inicial:
1. Desplegar V74 en la rama v73-postgres (o nueva v74-arcade-pool).
2. Abrir Control Center LFF.
3. En Bolsa Arcade Shopify seleccionar 5% y cantidad 2.
4. Crear lote en Shopify.
5. Si quedan pendientes, pulsar Sincronizar lotes pendientes.
6. Confirmar que la tabla muestra 2 disponibles.
7. Solo despues crear 100 codigos por cada porcentaje.

Nota: no generar 600 codigos de golpe antes de validar el lote de 2.
