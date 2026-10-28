/**
 * Verifica que el módulo reutilizable (modulo/) use LAS MISMAS piezas que la
 * aplicación, no copias divergentes:
 *
 *  1. Herramientas: modulo/tools/proveedor.ts reexporta las de src/tools.
 *  2. Prompt: el cuerpo de modulo/agent.md (sin frontmatter) == agent/prompt.md.
 *  3. Conocimiento: el cuerpo de modulo/skill/.../SKILL.md (sin frontmatter)
 *     == src/knowledge/registro-proveedor.md (ignorando diferencias triviales
 *     de rutas de referencia).
 *
 *   npm run verify:modulo
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { herramientas as herrApp } from "../src/tools/proveedor.ts";
import { herramientas as herrModulo } from "../modulo/tools/proveedor.ts";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function quitarFrontmatter(texto: string): string {
  if (!texto.startsWith("---")) return texto.trim();
  const fin = texto.indexOf("\n---", 3);
  if (fin === -1) return texto.trim();
  const salto = texto.indexOf("\n", fin + 1);
  return texto.slice(salto + 1).trim();
}

/** Normaliza para comparar cuerpos ignorando espacios finales y rutas de ref. */
function normalizar(texto: string): string {
  return texto
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .join("\n")
    .trim();
}

async function leer(rel: string): Promise<string> {
  return fs.readFile(path.join(directory, rel), "utf8");
}

async function main(): Promise<void> {
  const errores: string[] = [];

  // 1) Herramientas: mismas referencias (reexport), no copias.
  const clavesApp = Object.keys(herrApp).sort();
  const clavesMod = Object.keys(herrModulo).sort();
  if (JSON.stringify(clavesApp) !== JSON.stringify(clavesMod)) {
    errores.push(
      `las herramientas difieren: app=[${clavesApp}] modulo=[${clavesMod}]`,
    );
  } else {
    for (const k of clavesApp) {
      const a = (herrApp as Record<string, unknown>)[k];
      const m = (herrModulo as Record<string, unknown>)[k];
      if (a !== m) {
        errores.push(`la herramienta ${k} no es la misma referencia (es copia)`);
      }
    }
  }

  // 2) Prompt.
  const promptApp = normalizar(await leer("agent/prompt.md"));
  const promptMod = normalizar(quitarFrontmatter(await leer("modulo/agent.md")));
  if (promptApp !== promptMod) {
    errores.push("el cuerpo de modulo/agent.md difiere de agent/prompt.md");
  }

  // 3) Conocimiento (comparación de cuerpo, tolerante a la línea de referencia
  //    a agent/prompt.md vs agent.md).
  const relajar = (t: string): string =>
    t.replace(/`agent\/prompt\.md`/g, "`agent.md`");
  const conApp = normalizar(
    relajar(await leer("src/knowledge/registro-proveedor.md")),
  );
  const conMod = normalizar(
    quitarFrontmatter(await leer("modulo/skill/registro-proveedor/SKILL.md")),
  );
  // El SKILL tiene un título extra (# Conocimiento...), que también está en la
  // app; comparamos a partir del primer encabezado común.
  const desde = (t: string): string => {
    const i = t.indexOf("# Conocimiento del proceso");
    return i >= 0 ? t.slice(i).trim() : t;
  };
  if (desde(conApp) !== desde(conMod)) {
    errores.push(
      "el cuerpo de SKILL.md difiere de src/knowledge/registro-proveedor.md",
    );
  }

  if (errores.length > 0) {
    console.error("✗ El módulo NO es coherente con la app:");
    for (const e of errores) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }
  console.log("✓ Módulo coherente con la app:");
  console.log("  - herramientas: mismas referencias (reexport, no copia)");
  console.log("  - prompt: cuerpo idéntico a agent/prompt.md");
  console.log("  - conocimiento: cuerpo idéntico a src/knowledge/");
}

main().catch((e) => {
  console.error("Error en la verificación del módulo:", e);
  process.exitCode = 1;
});
