LA FÁBRICA FRIKI — BACKEND V90 TODO-EN-UNO
Base: backend V89 real descargado de GitHub · rama v73-postgres
Fecha: 30/09/2026

ESTADO DE ESTE PAQUETE
- GENERADO sobre el backend completo V89 real.
- VALIDADO localmente a nivel de sintaxis JS/JSX, estructura Prisma, correspondencia migración/schema e integridad de ZIP.
- NO DESPLEGADO todavía en GitHub/Render.
- NO PROBADO todavía contra la PostgreSQL live ni mediante compras reales de Shopify.
- No toca el theme V96. La conexión visual de las nuevas funciones se hará después en V97.
- No modifica la MATRIX de 754 variantes ni las mecánicas del Arcade.

OBJETIVO
Concentrar en UNA subida grande de backend la persistencia y lógica pendiente que antes estaba repartida entre localStorage/maquetas o incompleta.

1) FAVORITOS + RECUPERACIÓN DE VENTA
- POST app proxy existente esperado: /apps/lff/retention/favorite
- Persiste favorito por cliente/visitante y producto.
- Campaña de recuperación única por favorito/producto.
- Espera por defecto: 48 h (configurable con LFF_RETENTION_WAIT_HOURS).
- Descuento real Shopify: 20%, limitado al producto, un uso, caduca en 5 días.
- Si el favorito termina comprado, el webhook orders/paid cancela/marca la campaña como comprada.
- Si no hay cliente ni correo alcanzable NO se genera un cupón público suelto: queda waiting_contact.
- Cola OutboundMessage preparada para email, pero NO se marca como enviado sin proveedor real.
- Procesador protegido: /api/lff/retention/process con X-LFF-Admin-Token.

IMPORTANTE: V96 ya envía el alta de favorito. La retirada/eliminación completa y las pantallas Admin se conectarán en Theme V97.

2) RESEÑAS REALES
- PostgreSQL: ProductReview.
- GET/POST público mediante /apps/lff/reviews.
- Moderación Admin: aprobar, ocultar, mostrar, rechazar y eliminar.
- Alta manual desde Admin.
- Imágenes guardadas mediante Shopify Files.
- No depende de localStorage en el backend.

3) GASTOS + FINANZAS
- PostgreSQL: Expense.
- Tickets/imágenes en Shopify Files.
- Histórico, totales y total del mes.
- Borrado lógico con auditoría.
- Cálculo backend de reparto del beneficio:
  · 15% asociación
  · 30% ahorro
  · 30% marketing
  · 25% propietarios
  · el 25% se divide entre Alejandro/Gabriel.

4) AUDITORÍA
- Se reutiliza AuditLog existente.
- Se amplía auditoría de productos: creación, media, asignación, portada, edición, precios, estado, publicación y borrado.
- Se registran acciones de reseñas, gastos, comerciales, B2B, pagos, clientes, Caja Friki y retención.
- La consulta completa de auditoría sigue reservada a owner/Alejandro.

5) CLIENTES / CUENTAS / CLUB / CAJA FRIKI
- CustomerAccount + CustomerSession con contraseña scrypt y bloqueo por intentos.
- Registro, login, logout, cambio de contraseña, perfil y recuperación.
- Vinculación best-effort con Customer real de Shopify.
- ClubProfile persistente.
- BoxSubscription + BoxVoucher persistentes.
- La Caja NO se activa automáticamente sin cobro real: Admin debe confirmar paymentConfirmed.
- Tras activación confirmada puede generar bono real Shopify de 15 € para ese cliente.
- Recuperación de acceso + reset administrativo real.

IMPORTANTE: no se ha inventado una pasarela de suscripción mensual. Hasta elegir/configurar proveedor de cobro recurrente, el backend solo permite activación manual verificada.

6) COMERCIALES
- Mantiene auth/códigos reales existentes.
- Solicitudes, aprobación/rechazo, suspensión/reactivación y recuperación persistentes.
- Atribuciones de clientes persistentes y visibles.
- Ventas/comisiones persistentes.
- Comisiones pasan de pending_validation a available al cumplir su fecha.
- MARCAR COMO PAGADO crea Payout real y marca las comisiones como paid.
- Payout guarda fecha, método, referencia, notas y administrador que lo marcó.
- Histórico y saldos pending/available/paid en dashboard.
- Chats con tiendas vinculadas persistentes.
- Se mantiene la lógica preexistente de comisión: 30% primera venta atribuida y 10% posteriores.
- El código personal 40% sigue usando la protección/vinculación ya existente; no se convierte en un código público abierto.

7) EMPRESAS / TIENDAS B2B
- B2BCompany ampliada con datos reales, contraseña hash, estados y sesiones.
- Solicitud, aprobación/rechazo, login, logout, recuperación y suspensión.
- Asociación real a comercial y priceTier direct_60 / referred_55.
- Chat persistente empresa ↔ comercial/Admin.
- B2BOrder nuevo: pedidos profesionales detectados desde webhooks Shopify.
- orders/paid guarda pedido, importes, moneda y empresa.
- orders/cancelled marca pedido cancelado.
- refunds/create marca revisión de devolución y registra importe reembolsado cuando viene en el webhook.
- Dashboard B2B devuelve historial real de pedidos.

8) TRÁFICO / ANALYTICS PROPIO
- TrafficEvent persistente.
- Endpoint app proxy: /apps/lff/analytics/event.
- Clasifica origen: commercials / web / companies / marketing.
- Respeta analyticsConsent=false.
- orders/paid añade evento de venta y vincula companyId cuando corresponde.
- No usa ni finge Shopify Analytics avanzado porque read_reports/read_analytics no están confirmados.

9) MENSAJERÍA EXTERNA
- OutboundMessage deja preparada una cola de email/WhatsApp/proveedor.
- NO envía nada por sí sola.
- NO se marca sentAt hasta integrar un proveedor real.
- Elegir proveedor se deja para una fase posterior.

10) MIGRACIÓN V90
Nueva migración:
prisma/migrations/20260930073000_backend_v90_core/migration.sql

Amplía:
- B2BCompany
- Payout

Crea:
- CustomerAccount
- CustomerSession
- ClubProfile
- BoxSubscription
- BoxVoucher
- Favorite
- RetentionCampaign
- ProductReview
- Expense
- AccessRecoveryRequest
- B2BSession
- B2BOrder
- TrafficEvent
- OutboundMessage

Render ya ejecuta prisma migrate deploy durante el arranque según la configuración actual. No ejecutar SQL manualmente salvo que el despliegue lo requiera expresamente.

11) ARCHIVOS NUEVOS/MODIFICADOS DE V90
- prisma/schema.prisma
- prisma/migrations/20260930073000_backend_v90_core/migration.sql
- app/lib/api-auth.server.js
- app/lib/lff-media.server.js
- app/lib/lff-v90.server.js
- app/routes/api.lff.admin.operations.jsx
- app/routes/api.lff.admin.products.jsx
- app/routes/api.lff.b2b.auth.jsx
- app/routes/api.lff.b2b.dashboard.jsx
- app/routes/api.lff.commercial.auth.jsx
- app/routes/api.lff.commercial.dashboard.jsx
- app/routes/api.lff.customer.auth.jsx
- app/routes/api.lff.retention.process.jsx
- app/routes/apps.lff.analytics.event.jsx
- app/routes/apps.lff.retention.favorite.jsx
- app/routes/apps.lff.reviews.jsx
- app/routes/webhooks.customers.create.jsx
- app/routes/webhooks.orders.paid.jsx
- app/routes/webhooks.orders.cancelled.jsx
- app/routes/webhooks.refunds.create.jsx
- V90_BACKEND_TODO_EN_UNO_README.txt
- V90_VALIDACION_LOCAL.txt

12) SUBIDA A GITHUB
Usar el ZIP SOLO-SUBIR.
Subir su contenido desde la raíz del repositorio lff-shopify-backend, rama v73-postgres, respetando las carpetas.
Hacer UN commit para V90.
Render debe autodesplegar desde esa rama.

NO subir node_modules.
NO crear una rama nueva.
NO tocar el theme en este paso.

13) DESPUÉS DEL DEPLOY
Antes de dar V90 por probado comprobar, en este orden:
1. Render arranca y prisma migrate deploy termina sin error.
2. /health o portada backend responde.
3. Login Admin sigue funcionando.
4. Productos/Admin y Arcade Analytics siguen funcionando (regresión).
5. Alta de favorito crea Favorite/RetentionCampaign.
6. Reseña crea pendiente y Admin puede moderarla.
7. Gasto guarda y recupera ticket.
8. Solicitud/aprobación comercial y B2B.
9. Marcar comisión como pagada.
10. Cuenta cliente/Club/Caja en modo pendiente y activación solo con cobro confirmado.
11. Evento de tráfico.
12. Webhook de pedido real/sandbox para B2B, favorito y comisión.

14) DEPENDENCIAS QUE SIGUEN FUERA DEL ZIP
- Proveedor real de email/WhatsApp.
- Proveedor/cobro recurrente de Caja Friki.
- Automatización horaria del procesador de retención (o disparador equivalente desde V97/cron).
- Shopify Analytics avanzado si más adelante se conceden scopes específicos.
- Buscador visual real: permanece en mantenimiento.

Este paquete está preparado para que el siguiente paso sea UNA subida backend y, después de validar el despliegue, construir UN Theme V97 acumulativo que sustituya las UIs/localStorage por estos endpoints reales.
