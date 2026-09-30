LA FÁBRICA FRIKI — V90.1 CORRECCIÓN DE BUILD

Motivo:
Render detectó un import server-only que no podía eliminar del bundle cliente en React Router 7.18.2.

Correcciones:
- app/routes/api.lff.b2b.dashboard.jsx: eliminado shopDomain del import de lff-v90.server porque no se usaba.
- app/routes/api.lff.admin.operations.jsx: eliminado cleanEmail del import de lff-v90.server porque no se usaba.

Esta corrección no cambia lógica de negocio, base de datos, migraciones, Arcade, productos ni theme.

Estado:
- Corrección preparada tras analizar el error exacto de Render.
- Comprobación estática de imports server-only de las rutas V90: sin imports nombrados sin uso detectados.
- Debe confirmarse con el siguiente build de Render.
