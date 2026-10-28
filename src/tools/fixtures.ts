import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CampoSolicitado,
  CeldaPlantilla,
  CampoPlantilla,
  Glosario,
  Maestro,
  Solicitud,
  Soporte,
  Pais,
} from "./tipos.ts";

/**
 * Rutas de los fixtures, resueltas desde la raíz del proyecto (ctx.directory).
 * Nunca se usan rutas absolutas codificadas.
 */
export function rutasFixtures(directory: string) {
  const base = path.join(directory, "fixtures", "reto-01");
  return {
    base,
    casos: path.join(base, "casos"),
    maestro: path.join(base, "repositorio", "maestro.json"),
    soportesDir: path.join(base, "repositorio", "soportes"),
    soportesIndex: path.join(base, "repositorio", "soportes", "index.json"),
    glosario: path.join(base, "glosario-campos.json"),
  };
}

async function leerJson<T>(ruta: string): Promise<T> {
  const texto = await fs.readFile(ruta, "utf8");
  return JSON.parse(texto) as T;
}

export async function cargarMaestro(directory: string): Promise<Maestro> {
  return leerJson<Maestro>(rutasFixtures(directory).maestro);
}

export async function cargarGlosario(directory: string): Promise<Glosario> {
  return leerJson<Glosario>(rutasFixtures(directory).glosario);
}

export async function cargarSoportes(directory: string): Promise<Soporte[]> {
  return leerJson<Soporte[]>(rutasFixtures(directory).soportesIndex);
}

export async function cargarSolicitud(
  directory: string,
  caso: string,
): Promise<Solicitud> {
  const ruta = path.join(rutasFixtures(directory).casos, caso, "solicitud.json");
  return leerJson<Solicitud>(ruta);
}

export async function cargarSoportesExigidos(
  directory: string,
  caso: string,
): Promise<string[]> {
  const ruta = path.join(
    rutasFixtures(directory).casos,
    caso,
    "soportes-exigidos.json",
  );
  return leerJson<string[]>(ruta);
}

/**
 * Carga los campos solicitados normalizados desde la plantilla del caso,
 * sea Excel (plantilla-celdas.json) o PDF/portal (plantilla-campos.json).
 */
export async function cargarCamposSolicitados(
  directory: string,
  caso: string,
  formato: Solicitud["formato"],
): Promise<CampoSolicitado[]> {
  const casoDir = path.join(rutasFixtures(directory).casos, caso);
  if (formato === "xlsx") {
    const celdas = await leerJson<CeldaPlantilla[]>(
      path.join(casoDir, "plantilla-celdas.json"),
    );
    return celdas.map((c) => ({
      etiqueta: c.etiqueta,
      obligatorio: true,
      hoja: c.hoja,
      celda_etiqueta: c.celda_etiqueta,
      celda_valor: c.celda_valor,
    }));
  }
  const campos = await leerJson<CampoPlantilla[]>(
    path.join(casoDir, "plantilla-campos.json"),
  );
  return campos.map((c) => ({ etiqueta: c.etiqueta, obligatorio: c.obligatorio }));
}

/** Lista los nombres de carpeta de todos los casos disponibles. */
export async function listarCasos(directory: string): Promise<string[]> {
  const dir = rutasFixtures(directory).casos;
  const entradas = await fs.readdir(dir, { withFileTypes: true });
  return entradas
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Devuelve true si el caso existe en fixtures. */
export async function casoExiste(
  directory: string,
  caso: string,
): Promise<boolean> {
  try {
    await fs.access(path.join(rutasFixtures(directory).casos, caso));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resuelve un valor del maestro por clave en notación de punto
 * (ej. "banco.nombre"). Devuelve undefined si no existe.
 * Convierte números a string y rechaza objetos (solo valores escalares).
 */
export function resolverClave(
  maestro: Maestro,
  clave: string,
): string | undefined {
  const partes = clave.split(".");
  let actual: unknown = maestro;
  for (const parte of partes) {
    if (actual === null || actual === undefined || typeof actual !== "object") {
      return undefined;
    }
    actual = (actual as Record<string, unknown>)[parte];
  }
  if (actual === null || actual === undefined) return undefined;
  if (typeof actual === "string") return actual;
  if (typeof actual === "number" || typeof actual === "boolean") {
    return String(actual);
  }
  // Objetos/arrays no son valores llenables.
  return undefined;
}

/** Nombre del identificador tributario por país (RN1). */
export function identificadorPorPais(pais: Pais): string {
  switch (pais) {
    case "CO":
      return "NIT";
    case "EC":
    case "PE":
    case "PA":
      return "RUC";
    case "HN":
      return "RTN";
    default:
      return "Identificación tributaria";
  }
}

/** Etiquetas que representan el identificador tributario. */
const ETIQUETAS_IDENTIFICADOR = new Set([
  "nit",
  "ruc",
  "rtn",
  "identificación tributaria",
  "identificacion tributaria",
  "número de identificación fiscal",
  "numero de identificacion fiscal",
]);

export function esEtiquetaIdentificador(etiqueta: string): boolean {
  return ETIQUETAS_IDENTIFICADOR.has(etiqueta.trim().toLowerCase());
}

/**
 * Fecha de ejecución para calcular vigencias. Configurable por env
 * FECHA_EJECUCION (YYYY-MM-DD); si no, usa la fecha actual.
 */
export function fechaEjecucion(): Date {
  const env = process.env.FECHA_EJECUCION?.trim();
  if (env) {
    const d = new Date(`${env}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/** True si el soporte está vencido respecto a la fecha de ejecución. */
export function soporteVencido(soporte: Soporte, hoy: Date): boolean {
  if (!soporte.vigencia_hasta) return false;
  const vig = new Date(`${soporte.vigencia_hasta}T23:59:59Z`);
  if (Number.isNaN(vig.getTime())) return false;
  return vig.getTime() < hoy.getTime();
}
