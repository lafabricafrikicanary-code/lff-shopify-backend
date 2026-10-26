import type { Config } from "@react-router/dev/config";

// Shopify storefront -> app proxy -> Render uses different hostnames.
// Trust only this store's exact storefront hosts for React Router form actions;
// all other origins remain subject to the normal CSRF protection.
export default {
  allowedActionOrigins: [
    "lafabricafriki.es",
    "www.lafabricafriki.es",
    "unvufs-6t.myshopify.com",
  ],
} satisfies Config;
