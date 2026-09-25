# La Fabrica Friki - Backend Shopify

Backend de app Shopify para convertir las zonas de comerciales, tiendas/B2B,
Arcade, codigos y comisiones en funcionalidad server-side.

## Estado actual

- App vinculada al `client_id` de Shopify `62b68f5e3b3a348d914e98db544f3bdd`.
- Panel interno LFF creado en `/app`.
- Pagina de auditoria creada en `/app/audit`.
- Se elimino la accion demo de Shopify que generaba productos.
- Esquema Prisma creado para:
  - comerciales,
  - codigos comerciales,
  - atribuciones cliente-comercial,
  - comisiones,
  - pagos manuales,
  - tiendas B2B,
  - chats,
  - canjes Arcade,
  - codigos de descuento emitidos,
  - webhooks procesados,
  - auditoria.
- Webhooks declarados:
  - `orders/paid`,
  - `orders/cancelled`,
  - `refunds/create`,
  - `customers/create`,
  - `app/uninstalled`,
  - `app/scopes_update`.
- App proxy declarado en `/apps/lff`.
- Validaciones locales pasadas:
  - `npm run build`
  - `npm run typecheck`
  - `npm run lint`
  - `npx prisma migrate status`

## Variables necesarias en hosting

Estas variables deben existir en el servidor publico donde se despliegue la app:

```sh
SHOPIFY_API_KEY=62b68f5e3b3a348d914e98db544f3bdd
SHOPIFY_API_SECRET=<secret de la app Shopify>
SHOPIFY_APP_URL=https://lff-shopify-backend.adept-sugar-9802.chatgpt.site
SCOPES=read_customers,write_customers,read_price_rules,write_price_rules,read_discounts,write_discounts,read_draft_orders,write_draft_orders,read_inventory,read_metaobjects,write_metaobjects,read_orders,write_orders,read_products,write_app_proxy
DATABASE_URL=<base de datos persistente>
NODE_ENV=production
```

`SHOPIFY_API_SECRET` ya fue guardado en OpenClaw como secreto protegido
`SHOPIFY_API_SECRET`; no debe copiarse en archivos ni chats.

## Pendiente obligatorio antes de decir "finalizado"

1. Desplegar este backend en una URL HTTPS publica y estable.
   - URL preparada en Sites: `https://lff-shopify-backend.adept-sugar-9802.chatgpt.site`
2. Cambiar `application_url` y `auth.redirect_urls` en `shopify.app.toml` a esa URL.
   - Hecho para la URL de Sites anterior.
3. Ejecutar `npm run deploy` para publicar configuracion, scopes, webhooks y app proxy en Shopify.
4. Reinstalar/actualizar la app en la tienda si Shopify lo solicita.
5. Probar en Shopify Admin que `/app` abre el panel LFF, no `lafabricafriki.es`.
6. Crear un comercial de prueba desde el panel y verificar que se generan dos codigos reales en Shopify.
7. Realizar pedido de prueba con codigo comercial y comprobar atribucion + comision pendiente.
8. Probar cancelacion/refund y comprobar marcado de comisiones para revision.
9. Conectar el tema/Arcade al app proxy `/apps/lff/arcade/redeem`.

## Nota de seguridad

Nada sensible debe volver al tema Liquid/JS. El tema puede pedir acciones al
backend por app proxy, pero descuentos, comisiones, atribuciones y validaciones
deben resolverse aqui.
