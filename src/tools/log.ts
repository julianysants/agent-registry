import { promises as fs } from "node:fs";
import path from "node:path";

export interface EntradaLog {
  ts: string;
  herramienta: string;
  ok: boolean;
  resumen: string;
}

/** Carpeta de salida de un caso: out/<caso>/ */
export function outCaso(directory: string, caso: string): string {
  return path.join(directory, "out", caso);
}

/**
 * Registra una entrada en out/<caso>/log.jsonl y en out/log.jsonl (RN5).
 * El logging nunca lanza: si falla, se ignora silenciosamente para no romper
 * la herramienta.
 */
export async function registrar(
  directory: string,
  caso: string,
  entrada: Omit<EntradaLog, "ts">,
): Promise<void> {
  const linea = JSON.stringify({ ts: new Date().toISOString(), ...entrada }) + "\n";
  try {
    const dirCaso = outCaso(directory, caso);
    await fs.mkdir(dirCaso, { recursive: true });
    await fs.appendFile(path.join(dirCaso, "log.jsonl"), linea, "utf8");
    const outDir = path.join(directory, "out");
    await fs.mkdir(outDir, { recursive: true });
    await fs.appendFile(path.join(outDir, "log.jsonl"), linea, "utf8");
  } catch {
    // Logging best-effort: no propagamos errores de IO.
  }
}
