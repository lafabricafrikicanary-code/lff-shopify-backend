LA FÁBRICA FRIKI — BACKEND V91 TODO EN UNO
Fecha: 30/09/2026
Base: Backend V90.1 desplegado en rama v73-postgres

OBJETIVO
Este paquete es SOLO BACKEND. No contiene cambios del theme. Agrupa en una única subida las funciones pedidas después de V90.1 para Comerciales, YouTubers/Creadores, Categorías, Familias, suscripciones y tráfico en tiempo real.

1) COMERCIALES / ADMINISTRACIÓN
- Mantiene y amplía las operaciones administrativas reales ya existentes en PostgreSQL.
- Solicitudes, aprobar/rechazar, activar/suspender, recuperación, comisiones, pagos y auditoría.
- Compras propias de comerciales quedan registradas separadamente y no generan comisión.
- Chat directo persistente entre Administración y cada comercial/YouTuber.
- B2B/Tiendas sigue administrándose desde api.lff.admin.operations: aprobar/rechazar, suspender/reactivar, asignar comercial, recuperar acceso, pedidos y chat.
- La retirada visual de accesos Admin desde Comerciales/Tiendas corresponde al siguiente theme; backend queda centralizado para ello.

2) YOUTUBERS / CREADORES
- CommercialUser incorpora kind=creator para reutilizar el sistema de acceso de Comerciales sin duplicarlo.
- Cuenta propia y panel usando el mismo acceso de Comerciales.
- Código promocional Shopify real por creador. El porcentaje de descuento al seguidor es configurable por Administración al aprobar/crear; por defecto 10%.
- El solicitante público NO puede decidir el porcentaje de descuento del código.
- Reglas de comisión definitivas:
  * 30% de los productos de su propia marca/familias, SIEMPRE, aunque la venta no use su código.
  * 10% del resto de productos cuando la venta está atribuida a ese creador.
  * No existe el 30% de “primera venta” para YouTubers.
  * Si una compra mezcla producto propio + resto de tienda: 30% sobre lo propio y 10% sobre lo referido restante.
- Último código válido usado = referente actual del cliente. Un nuevo código sustituye la atribución anterior para futuras compras.
- Las comisiones guardan detalles por parte para que Administración pueda auditar qué porcentaje corresponde a producto propio/referido.
- Cancelaciones y reembolsos continúan afectando a todas las comisiones del pedido mediante los webhooks existentes.

3) FAMILIAS VINCULADAS A YOUTUBERS
- LffFamily puede vincularse directamente a un creatorId.
- Una familia puede pertenecer a un YouTuber.
- Al vincular/cambiar la familia se sincronizan los productos Shopify ya existentes de esa familia.
- Productos nuevos/editados sincronizan automáticamente la asociación CreatorProduct según su familia.
- El backend devuelve creador vinculado en la API de familias.

4) CATEGORÍAS PREPARABLES / OCULTAS / PUBLICADAS
- Nueva persistencia LffCategory en PostgreSQL.
- Estados: published / preparation / hidden.
- Categorías base se crean automáticamente al primer uso sin modificar las familias actuales.
- Nueva categoría YouTubers queda por defecto en preparation.
- Crear una familia en una categoría nueva crea la categoría en estado preparation.
- API Admin permite crear categoría y cambiar estado sin borrar productos/familias.
- La ocultación/publicación visual será aplicada por el siguiente theme.

5) FAMILIAS DINÁMICAS EN PRODUCTOS
- La API de familias devuelve la lista real almacenada y categorías reales.
- Esto permite que el siguiente theme refresque inmediatamente el selector Crear/Modificar producto tras crear una familia, sin listas manuales.

6) CLIENTES / CLUB / CAJA FRIKI
- Admin dispone de view=subscriptions para listar Club y Caja Friki con datos reales.
- Caja Friki incorpora country además de dirección, CP y ciudad.
- Se mantienen los controles reales de activación/cancelación y la exigencia de confirmar un cobro real antes de activar.

7) TRÁFICO EN TIEMPO REAL
- Nueva tabla TrafficPresence.
- Heartbeat actualiza presencia por visitante sin almacenar IP en claro; solo hash de IP.
- Ubicación aproximada país/región/ciudad/coordenadas para el futuro globo 3D cuando la plataforma/proveedor pueda resolverla.
- Admin view=traffic-live devuelve visitantes activos (últimos 90 s), origen, página, país/ciudad y coordenadas, más agregados por origen/país/página.
- El endpoint de analytics respeta analyticsConsent=false; el theme V98 enviará heartbeat únicamente cuando haya consentimiento de analítica.
- No se inventan ubicaciones: si no se pueden resolver, quedan vacías.

8) MIGRACIÓN
Nueva migración:
prisma/migrations/20260930110000_backend_v91_creators_categories_live/migration.sql

Añade:
- campos de creador/comisiones en CommercialUser, CommercialApplication y Commission
- creatorId en LffFamily
- country en BoxSubscription
- LffCategory
- CreatorProduct
- CommercialOwnPurchase
- TrafficPresence

9) ARCHIVOS NUEVOS/MODIFICADOS DE V91
- app/lib/lff-v91.server.js
- app/routes/api.lff.admin.operations.jsx
- app/routes/api.lff.admin.products.jsx
- app/routes/api.lff.commercial.auth.jsx
- app/routes/api.lff.commercial.dashboard.jsx
- app/routes/api.lff.customer.auth.jsx
- app/routes/api.lff.families.jsx
- app/routes/apps.lff.analytics.event.jsx
- app/routes/webhooks.orders.paid.jsx
- prisma/schema.prisma
- prisma/migrations/20260930110000_backend_v91_creators_categories_live/migration.sql
- V91_BACKEND_TODO_EN_UNO_README.txt
- V91_VALIDACION_LOCAL.txt

10) NO TOCADO
- MATRIX de 754 variantes.
- Precios/modelos internos.
- Arcade y sus mecánicas.
- Gestor de archivos Shopify existente.
- Rutas/scopes secretos.
- Theme V97.

11) DESPLIEGUE
Subir el contenido del ZIP SOLO-SUBIR a la raíz de la rama v73-postgres en un único commit. Render hará autodeploy y ejecutará prisma migrate deploy al arrancar.

Estado al generar este ZIP:
GENERADO + validación estática local. NO afirmar desplegado/probado hasta comprobar Render.
