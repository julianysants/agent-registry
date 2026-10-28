import path from "node:path";
import { promises as fs } from "node:fs";
import type {
  CampoMapeado,
  CampoSolicitado,
  Glosario,
  Maestro,
  Mapeo,
  Pais,
  Soporte,
} from "./tipos.ts";
import {
  esEtiquetaIdentificador,
  resolverClave,
  soporteVencido,
} from "./fixtures.ts";

/**
 * Mapea cada campo solicitado contra el maestro usando el glosario y aplica
 * las reglas de país (RN1). Devuelve el mapeo agrupado por estado.
 *
 * - lleno: la etiqueta está en el glosario y la clave existe en el maestro.
 * - faltante: la etiqueta no está en el glosario, o la clave no existe.
 * - requiere_confirmacion: identificador tributario de país != CO (RN1).
 *
 * Nunca inventa valores.
 */
export function mapearCampos(
  campos: CampoSolicitado[],
  maestro: Maestro,
  glosario: Glosario,
  pais: Pais,
): Mapeo {
  // Índice del glosario normalizado (case-insensitive, trim).
  const glosarioNorm = new Map<string, string>();
  for (const [etiqueta, clave] of Object.entries(glosario)) {
    glosarioNorm.set(etiqueta.trim().toLowerCase(), clave);
  }

  const llenos: CampoMapeado[] = [];
  const faltantes: CampoMapeado[] = [];
  const requiere_confirmacion: CampoMapeado[] = [];

  for (const campo of campos) {
    const claveGlosario = glosarioNorm.get(campo.etiqueta.trim().toLowerCase());

    // Etiqueta no reconocida en el glosario -> faltante.
    if (!claveGlosario) {
      faltantes.push({
        ...campo,
        estado: "faltante",
        nota: "etiqueta no reconocida en el glosario",
      });
      continue;
    }

    const valor = resolverClave(maestro, claveGlosario);

    // Clave reconocida pero sin valor en el maestro -> faltante.
    if (valor === undefined) {
      faltantes.push({
        ...campo,
        estado: "faltante",
        clave_maestro: claveGlosario,
        nota: "sin valor en el maestro",
      });
      continue;
    }

    // RN1: identificador tributario de país extranjero -> requiere_confirmacion.
    if (esEtiquetaIdentificador(campo.etiqueta) && pais !== "CO") {
      requiere_confirmacion.push({
        ...campo,
        estado: "requiere_confirmacion",
        clave_maestro: claveGlosario,
        valor,
        nota: "identificador extranjero: se propone el NIT colombiano, confirmar equivalencia",
      });
      continue;
    }

    llenos.push({
      ...campo,
      estado: "lleno",
      clave_maestro: claveGlosario,
      valor,
    });
  }

  return { llenos, faltantes, requiere_confirmacion };
}

/** Todos los campos mapeados en una sola lista. */
export function todosLosCampos(mapeo: Mapeo): CampoMapeado[] {
  return [...mapeo.llenos, ...mapeo.requiere_confirmacion, ...mapeo.faltantes];
}

export interface EstadoSoporte {
  tipo: string;
  presente: boolean;
  vencido: boolean;
  vigencia_hasta: string | null;
  archivo?: string;
}

/** Evalúa cada soporte exigido contra el índice del repositorio. */
export function evaluarSoportes(
  exigidos: string[],
  indice: Soporte[],
  hoy: Date,
): EstadoSoporte[] {
  return exigidos.map((tipo) => {
    const soporte = indice.find((s) => s.tipo === tipo);
    if (!soporte) {
      return { tipo, presente: false, vencido: false, vigencia_hasta: null };
    }
    return {
      tipo,
      presente: true,
      vencido: soporteVencido(soporte, hoy),
      vigencia_hasta: soporte.vigencia_hasta,
      archivo: soporte.archivo,
    };
  });
}

export interface EvaluacionBloqueo {
  listo_para_firma: boolean;
  motivos: string[];
}

/**
 * Determina si el paquete está listo para firma según RN3:
 * - soporte ausente o vencido -> bloquea
 * - campo obligatorio faltante o requiere_confirmacion -> bloquea
 * - campo faltante no obligatorio -> no bloquea
 */
export function evaluarBloqueo(
  mapeo: Mapeo,
  soportes: EstadoSoporte[],
): EvaluacionBloqueo {
  const motivos: string[] = [];

  for (const s of soportes) {
    if (!s.presente) motivos.push(`soporte ausente: ${s.tipo}`);
    else if (s.vencido) {
      motivos.push(`soporte vencido: ${s.tipo} (venció ${s.vigencia_hasta})`);
    }
  }

  for (const c of mapeo.faltantes) {
    if (c.obligatorio) {
      motivos.push(`campo obligatorio faltante: ${c.etiqueta}`);
    }
  }
  for (const c of mapeo.requiere_confirmacion) {
    if (c.obligatorio) {
      motivos.push(`campo obligatorio requiere confirmación: ${c.etiqueta}`);
    }
  }

  return { listo_para_firma: motivos.length === 0, motivos };
}

/** Limpia y recrea un directorio. */
export async function recrearDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

/** Asegura que exista un directorio. */
export async function asegurarDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Ruta relativa desde la raíz del proyecto, para mostrar al usuario. */
export function rutaRelativa(directory: string, absoluta: string): string {
  return path.relative(directory, absoluta) || absoluta;
}
