/**
 * demo.ts — ejecuta las herramientas para todos los casos SIN modelo y SIN clave.
 *
 *   npm run demo
 *
 * Verifica el flujo completo (leer -> mapear -> generar -> armar paquete -> envío)
 * e imprime un resumen por caso. `out/` se limpia al inicio para ser determinista.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listarCasos } from "./src/tools/fixtures.ts";
import { recrearDir } from "./src/tools/dominio.ts";
import {
  armar_paquete,
  generar_formulario,
  leer_solicitud,
  mapear_campos,
  simular_envio,
  type Ctx,
} from "./src/tools/proveedor.ts";

const directory = path.dirname(fileURLToPath(import.meta.url));

// Fecha de referencia fija para que la demo sea determinista (salvo timestamps
// del log). Se puede sobreescribir exportando FECHA_EJECUCION.
if (!process.env.FECHA_EJECUCION) {
  process.env.FECHA_EJECUCION = "2026-10-28";
}

type Json = Record<string, unknown>;

function parse(s: string): Json {
  return JSON.parse(s) as Json;
}

function linea(char = "─", n = 72): string {
  return char.repeat(n);
}

async function main(): Promise<void> {
  await recrearDir(path.join(directory, "out"));

  const casos = await listarCasos(directory);
  console.log(linea("═"));
  console.log(`DEMO — Registro como Proveedor · ${casos.length} casos`);
  console.log(`Fecha de ejecución (vigencias): ${process.env.FECHA_EJECUCION}`);
  console.log(linea("═"));

  for (const caso of casos) {
    const ctx: Ctx = { directory, sessionId: `demo-${caso}` };
    console.log(`\n▶ CASO: ${caso}`);
    console.log(linea());

    // 1) Leer solicitud
    const r1 = parse(await leer_solicitud.execute({ caso }, ctx));
    if (!r1.ok) {
      console.log(`  ✗ leer_solicitud: ${String(r1.error)}`);
      continue;
    }
    const d1 = r1.data as Json;
    console.log(
      `  • Cliente: ${String(d1.cliente)} (${String(d1.pais)}) · formato=${String(d1.formato)}`,
    );
    console.log(
      `  • Campos solicitados: ${(d1.campos as unknown[]).length} · soportes exigidos: ${(d1.soportes as unknown[]).length}`,
    );

    // 2) Mapear campos
    const r2 = parse(await mapear_campos.execute({ caso }, ctx));
    if (r2.ok) {
      const m = r2.data as Json;
      console.log(
        `  • Mapeo: ${(m.llenos as unknown[]).length} llenos, ${(m.faltantes as unknown[]).length} faltantes, ${(m.requiere_confirmacion as unknown[]).length} requieren confirmación`,
      );
      const faltantes = (m.faltantes as Array<{ etiqueta: string }>).map(
        (c) => c.etiqueta,
      );
      if (faltantes.length) console.log(`    ↳ faltantes: ${faltantes.join(", ")}`);
      const rc = (m.requiere_confirmacion as Array<{ etiqueta: string }>).map(
        (c) => c.etiqueta,
      );
      if (rc.length) console.log(`    ↳ confirmar: ${rc.join(", ")}`);
    } else {
      console.log(`  ✗ mapear_campos: ${String(r2.error)}`);
    }

    // 3) Generar formulario
    const r3 = parse(await generar_formulario.execute({ caso }, ctx));
    if (r3.ok) {
      const g = r3.data as Json;
      console.log(`  • Formulario (${String(g.formato)}): ${String(g.ruta)}`);
      if (g.nota) console.log(`    ↳ ${String(g.nota)}`);
    } else {
      console.log(`  ✗ generar_formulario: ${String(r3.error)}`);
    }

    // 4) Armar paquete
    const r4 = parse(await armar_paquete.execute({ caso }, ctx));
    if (r4.ok) {
      const p = r4.data as Json;
      const listo = p.listo_para_firma as boolean;
      console.log(`  • Paquete: ${String(p.ruta)}`);
      console.log(`  • Listo para firma: ${listo ? "✅ SÍ" : "❌ NO"}`);
      const ck = p.checklist as Json;
      const motivos = ck.motivos_bloqueo as string[];
      if (motivos.length) {
        console.log(`    ↳ bloqueos:`);
        for (const m of motivos) console.log(`        - ${m}`);
      }
    } else {
      console.log(`  ✗ armar_paquete: ${String(r4.error)}`);
    }

    // 5) Simular envío sin confirmar (debe fallar) y luego confirmado.
    const r5a = parse(await simular_envio.execute({ caso, confirmado: false }, ctx));
    console.log(
      `  • Envío sin confirmar: ${r5a.ok ? "⚠ permitido (inesperado)" : `✓ bloqueado (${String(r5a.error)})`}`,
    );
    const r5b = parse(await simular_envio.execute({ caso, confirmado: true }, ctx));
    console.log(
      `  • Envío confirmado: ${r5b.ok ? `✓ ${String((r5b.data as Json).ruta)}` : `✗ ${String(r5b.error)}`}`,
    );
  }

  console.log(`\n${linea("═")}`);
  console.log("DEMO completada. Revisa la carpeta out/ para ver los artefactos.");
  console.log(linea("═"));
}

main().catch((e) => {
  console.error("Error fatal en la demo:", e);
  process.exitCode = 1;
});
