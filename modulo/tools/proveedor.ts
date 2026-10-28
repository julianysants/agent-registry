/**
 * Herramientas del agente, reexportadas para uso como módulo independiente.
 *
 * Son LAS MISMAS herramientas que usa la aplicación (no una copia): este archivo
 * reexporta desde `src/tools/proveedor.ts`. Así se garantiza que el módulo y la
 * app no divergen.
 *
 * Uso sin el servidor:
 *
 *   import { herramientas } from "./modulo/tools/proveedor.ts";
 *   const ctx = { directory: process.cwd(), sessionId: "demo" };
 *   const res = await herramientas.proveedor_leer_solicitud.execute(
 *     { caso: "co-industrias-delta" }, ctx,
 *   );
 */
export {
  leer_solicitud,
  mapear_campos,
  generar_formulario,
  armar_paquete,
  simular_envio,
  herramientas,
  type Ctx,
  type Herramienta,
} from "../../src/tools/proveedor.ts";
