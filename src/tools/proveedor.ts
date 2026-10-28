import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import { z } from "zod";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { CampoMapeado, Mapeo } from "./tipos.ts";
import {
  cargarCamposSolicitados,
  cargarGlosario,
  cargarMaestro,
  cargarSoportes,
  cargarSoportesExigidos,
  cargarSolicitud,
  casoExiste,
  fechaEjecucion,
  identificadorPorPais,
  rutasFixtures,
} from "./fixtures.ts";
import {
  asegurarDir,
  evaluarBloqueo,
  evaluarSoportes,
  mapearCampos,
  rutaRelativa,
  todosLosCampos,
  type EstadoSoporte,
} from "./dominio.ts";
import { outCaso, registrar } from "./log.ts";

/** Contexto de ejecución que el servidor/demo inyecta. */
export interface Ctx {
  directory: string;
  sessionId: string;
}

/** Forma de una herramienta (contrato del reto). */
export interface Herramienta<A extends z.ZodRawShape> {
  description: string;
  args: A;
  execute(args: z.infer<z.ZodObject<A>>, ctx: Ctx): Promise<string>;
}

const ok = (data: unknown): string => JSON.stringify({ ok: true, data });
const fail = (error: string): string => JSON.stringify({ ok: false, error });

/** Mensaje de error legible a partir de un unknown, sin traza cruda. */
function mensajeError(e: unknown, contexto: string): string {
  if (e instanceof Error) return `${contexto}: ${e.message}`;
  return `${contexto}: error desconocido`;
}

// ---------------------------------------------------------------------------
// proveedor_leer_solicitud
// ---------------------------------------------------------------------------

export const leer_solicitud: Herramienta<{ caso: z.ZodString }> = {
  description:
    "Lee la solicitud (correo) y la plantilla de un caso y devuelve país, cliente, formato, lista de campos solicitados y soportes exigidos.",
  args: {
    caso: z
      .string()
      .describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
  },
  async execute(args, ctx) {
    try {
      if (!(await casoExiste(ctx.directory, args.caso))) {
        const err = `el caso "${args.caso}" no existe en fixtures/reto-01/casos/`;
        await registrar(ctx.directory, args.caso, {
          herramienta: "proveedor_leer_solicitud",
          ok: false,
          resumen: err,
        });
        return fail(err);
      }
      const solicitud = await cargarSolicitud(ctx.directory, args.caso);
      const campos = await cargarCamposSolicitados(
        ctx.directory,
        args.caso,
        solicitud.formato,
      );
      const soportes = await cargarSoportesExigidos(ctx.directory, args.caso);

      const data = {
        pais: solicitud.pais,
        cliente: solicitud.cliente,
        formato: solicitud.formato,
        asunto: solicitud.asunto,
        identificador_pais: identificadorPorPais(solicitud.pais),
        campos,
        soportes,
      };
      await registrar(ctx.directory, args.caso, {
        herramienta: "proveedor_leer_solicitud",
        ok: true,
        resumen: `${solicitud.cliente} (${solicitud.pais}), formato ${solicitud.formato}, ${campos.length} campos, ${soportes.length} soportes exigidos`,
      });
      return ok(data);
    } catch (e) {
      const err = mensajeError(e, "no se pudo leer la solicitud");
      await registrar(ctx.directory, args.caso, {
        herramienta: "proveedor_leer_solicitud",
        ok: false,
        resumen: err,
      });
      return fail(err);
    }
  },
};

// ---------------------------------------------------------------------------
// proveedor_mapear_campos
// ---------------------------------------------------------------------------

const campoSolicitadoSchema = z.object({
  etiqueta: z.string(),
  obligatorio: z.boolean(),
  hoja: z.string().optional(),
  celda_etiqueta: z.string().optional(),
  celda_valor: z.string().optional(),
});

export const mapear_campos: Herramienta<{
  caso: z.ZodString;
  campos: z.ZodOptional<z.ZodArray<typeof campoSolicitadoSchema>>;
}> = {
  description:
    "Cruza los campos solicitados de un caso contra el repositorio maestro usando el glosario y devuelve los campos agrupados en llenos, faltantes y requiere_confirmacion. Nunca inventa valores.",
  args: {
    caso: z
      .string()
      .describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
    campos: z
      .array(campoSolicitadoSchema)
      .optional()
      .describe(
        "Campos a mapear. Si se omite, se cargan automáticamente desde la plantilla del caso.",
      ),
  },
  async execute(args, ctx) {
    try {
      if (!(await casoExiste(ctx.directory, args.caso))) {
        const err = `el caso "${args.caso}" no existe`;
        await registrar(ctx.directory, args.caso, {
          herramienta: "proveedor_mapear_campos",
          ok: false,
          resumen: err,
        });
        return fail(err);
      }
      const solicitud = await cargarSolicitud(ctx.directory, args.caso);
      const campos =
        args.campos && args.campos.length > 0
          ? args.campos
          : await cargarCamposSolicitados(
              ctx.directory,
              args.caso,
              solicitud.formato,
            );
      const maestro = await cargarMaestro(ctx.directory);
      const glosario = await cargarGlosario(ctx.directory);

      const mapeo = mapearCampos(campos, maestro, glosario, solicitud.pais);
      await registrar(ctx.directory, args.caso, {
        herramienta: "proveedor_mapear_campos",
        ok: true,
        resumen: `${mapeo.llenos.length} llenos, ${mapeo.faltantes.length} faltantes, ${mapeo.requiere_confirmacion.length} requieren confirmación`,
      });
      return ok(mapeo);
    } catch (e) {
      const err = mensajeError(e, "no se pudieron mapear los campos");
      await registrar(ctx.directory, args.caso, {
        herramienta: "proveedor_mapear_campos",
        ok: false,
        resumen: err,
      });
      return fail(err);
    }
  },
};

// ---------------------------------------------------------------------------
// Generación del mapeo "efectivo" (recalculado desde fixtures para robustez).
// ---------------------------------------------------------------------------

async function mapeoDelCaso(ctx: Ctx, caso: string) {
  const solicitud = await cargarSolicitud(ctx.directory, caso);
  const campos = await cargarCamposSolicitados(
    ctx.directory,
    caso,
    solicitud.formato,
  );
  const maestro = await cargarMaestro(ctx.directory);
  const glosario = await cargarGlosario(ctx.directory);
  const mapeo = mapearCampos(campos, maestro, glosario, solicitud.pais);
  return { solicitud, mapeo };
}

/** Valor a escribir para un campo: vacío si no está lleno/confirmable. */
function valorParaFormulario(campo: CampoMapeado): string {
  if (campo.estado === "lleno") return campo.valor ?? "";
  if (campo.estado === "requiere_confirmacion") {
    return `${campo.valor ?? ""} (confirmar)`.trim();
  }
  return "";
}

// ---------------------------------------------------------------------------
// proveedor_generar_formulario
// ---------------------------------------------------------------------------

export const generar_formulario: Herramienta<{
  caso: z.ZodString;
  mapeo: z.ZodOptional<z.ZodUnknown>;
}> = {
  description:
    "Genera el formulario lleno en el formato del caso: xlsx (escribe celdas), pdf (documento generado) o portal (produce valores-portal.md). Devuelve la ruta y el formato.",
  args: {
    caso: z
      .string()
      .describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
    mapeo: z
      .unknown()
      .optional()
      .describe(
        "Mapeo previo (opcional). Si se omite, se recalcula desde la plantilla y el maestro.",
      ),
  },
  async execute(args, ctx) {
    try {
      if (!(await casoExiste(ctx.directory, args.caso))) {
        const err = `el caso "${args.caso}" no existe`;
        await registrar(ctx.directory, args.caso, {
          herramienta: "proveedor_generar_formulario",
          ok: false,
          resumen: err,
        });
        return fail(err);
      }
      const { solicitud, mapeo } = await mapeoDelCaso(ctx, args.caso);
      const dir = outCaso(ctx.directory, args.caso);
      await asegurarDir(dir);

      if (solicitud.formato === "xlsx") {
        const ruta = await generarXlsx(ctx.directory, args.caso, mapeo, dir);
        const rel = rutaRelativa(ctx.directory, ruta);
        await registrar(ctx.directory, args.caso, {
          herramienta: "proveedor_generar_formulario",
          ok: true,
          resumen: `xlsx generado en ${rel}`,
        });
        return ok({ ruta: rel, formato: "xlsx" });
      }

      if (solicitud.formato === "pdf") {
        const ruta = await generarPdf(solicitud.cliente, mapeo, dir);
        const rel = rutaRelativa(ctx.directory, ruta);
        await registrar(ctx.directory, args.caso, {
          herramienta: "proveedor_generar_formulario",
          ok: true,
          resumen: `pdf generado en ${rel}`,
        });
        return ok({ ruta: rel, formato: "pdf" });
      }

      // portal (P2): no se implementa el llenado. Se produce valores-portal.md.
      const ruta = await generarValoresPortal(solicitud.cliente, mapeo, dir);
      const rel = rutaRelativa(ctx.directory, ruta);
      await registrar(ctx.directory, args.caso, {
        herramienta: "proveedor_generar_formulario",
        ok: true,
        resumen: `formato portal no soportado para llenado automático; valores en ${rel}`,
      });
      return ok({
        ruta: rel,
        formato: "portal",
        nota: "formato no soportado para llenado automático; valores listos para copiar en valores-portal.md",
      });
    } catch (e) {
      const err = mensajeError(e, "no se pudo generar el formulario");
      await registrar(ctx.directory, args.caso, {
        herramienta: "proveedor_generar_formulario",
        ok: false,
        resumen: err,
      });
      return fail(err);
    }
  },
};

async function generarXlsx(
  directory: string,
  caso: string,
  mapeo: Mapeo,
  dir: string,
): Promise<string> {
  const solicitud = await cargarSolicitud(directory, caso);
  const celdas = await cargarCamposSolicitados(directory, caso, solicitud.formato);
  const wb = new ExcelJS.Workbook();

  // Índice de campos mapeados por etiqueta para buscar su valor.
  const porEtiqueta = new Map<string, CampoMapeado>();
  for (const c of todosLosCampos(mapeo)) porEtiqueta.set(c.etiqueta, c);

  for (const celda of celdas) {
    if (!celda.hoja || !celda.celda_etiqueta || !celda.celda_valor) continue;
    let hoja = wb.getWorksheet(celda.hoja);
    if (!hoja) hoja = wb.addWorksheet(celda.hoja);
    hoja.getCell(celda.celda_etiqueta).value = celda.etiqueta;
    const campo = porEtiqueta.get(celda.etiqueta);
    hoja.getCell(celda.celda_valor).value = campo
      ? valorParaFormulario(campo)
      : "";
  }

  const ruta = path.join(dir, "formulario.xlsx");
  await wb.xlsx.writeFile(ruta);
  return ruta;
}

function generarPdf(
  cliente: string,
  mapeo: Mapeo,
  dir: string,
): Promise<string> {
  const ruta = path.join(dir, "formulario.pdf");
  return new Promise<string>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const stream = doc.pipe(createWriteStream(ruta));
      doc.fontSize(18).text("Formulario de registro como proveedor", {
        align: "center",
      });
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor("#555").text(`Cliente: ${cliente}`, {
        align: "center",
      });
      doc.moveDown(1);
      doc.fillColor("#000");

      for (const campo of todosLosCampos(mapeo)) {
        const valor = valorParaFormulario(campo) || "—";
        doc.fontSize(10).fillColor("#333").text(campo.etiqueta, { continued: false });
        doc.fontSize(12).fillColor("#000").text(valor);
        doc.moveDown(0.5);
      }

      doc.end();
      stream.on("finish", () => resolve(ruta));
      stream.on("error", reject);
    } catch (e) {
      reject(e instanceof Error ? e : new Error("error generando PDF"));
    }
  });
}

async function generarValoresPortal(
  cliente: string,
  mapeo: Mapeo,
  dir: string,
): Promise<string> {
  const lineas: string[] = [
    `# Valores para portal — ${cliente}`,
    "",
    "> El llenado de portales web no se automatiza en este reto. Copie estos",
    "> valores manualmente en el portal del cliente.",
    "",
    "| Campo | Valor | Estado |",
    "| --- | --- | --- |",
  ];
  for (const campo of todosLosCampos(mapeo)) {
    const valor = valorParaFormulario(campo) || "—";
    lineas.push(`| ${campo.etiqueta} | ${valor} | ${campo.estado} |`);
  }
  const ruta = path.join(dir, "valores-portal.md");
  await fs.writeFile(ruta, lineas.join("\n") + "\n", "utf8");
  return ruta;
}

// ---------------------------------------------------------------------------
// proveedor_armar_paquete
// ---------------------------------------------------------------------------

export const armar_paquete: Herramienta<{ caso: z.ZodString }> = {
  description:
    "Arma out/<caso>/paquete/ con el formulario, copias de los soportes exigidos presentes, checklist.md y borrador-correo.md. Devuelve la ruta, si está listo para firma y el checklist.",
  args: {
    caso: z
      .string()
      .describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
  },
  async execute(args, ctx) {
    try {
      if (!(await casoExiste(ctx.directory, args.caso))) {
        const err = `el caso "${args.caso}" no existe`;
        await registrar(ctx.directory, args.caso, {
          herramienta: "proveedor_armar_paquete",
          ok: false,
          resumen: err,
        });
        return fail(err);
      }
      const { solicitud, mapeo } = await mapeoDelCaso(ctx, args.caso);
      const exigidos = await cargarSoportesExigidos(ctx.directory, args.caso);
      const indice = await cargarSoportes(ctx.directory);
      const hoy = fechaEjecucion();
      const estadoSoportes = evaluarSoportes(exigidos, indice, hoy);
      const bloqueo = evaluarBloqueo(mapeo, estadoSoportes);

      const dirCaso = outCaso(ctx.directory, args.caso);
      const dirPaquete = path.join(dirCaso, "paquete");
      await asegurarDir(dirPaquete);

      // Asegura que exista el formulario; si no, lo genera.
      await asegurarFormulario(ctx, args.caso, solicitud.formato, dirCaso);
      await copiarFormularioAlPaquete(solicitud.formato, dirCaso, dirPaquete);

      // Copia soportes presentes.
      const rutas = rutasFixtures(ctx.directory);
      for (const s of estadoSoportes) {
        if (s.presente && s.archivo) {
          try {
            await fs.copyFile(
              path.join(rutas.soportesDir, s.archivo),
              path.join(dirPaquete, s.archivo),
            );
          } catch {
            // Si el archivo placeholder no existe físicamente, se omite.
          }
        }
      }

      await escribirChecklist(dirPaquete, mapeo, estadoSoportes, bloqueo, hoy);
      await escribirBorradorCorreo(dirPaquete, solicitud.cliente, exigidos);

      const rel = rutaRelativa(ctx.directory, dirPaquete);
      const checklist = {
        soportes: estadoSoportes,
        campos_faltantes: mapeo.faltantes.map((c) => c.etiqueta),
        campos_requieren_confirmacion: mapeo.requiere_confirmacion.map(
          (c) => c.etiqueta,
        ),
        motivos_bloqueo: bloqueo.motivos,
      };

      await registrar(ctx.directory, args.caso, {
        herramienta: "proveedor_armar_paquete",
        ok: true,
        resumen: `paquete en ${rel}; listo_para_firma=${bloqueo.listo_para_firma}; ${bloqueo.motivos.length} bloqueos`,
      });
      return ok({
        ruta: rel,
        listo_para_firma: bloqueo.listo_para_firma,
        checklist,
      });
    } catch (e) {
      const err = mensajeError(e, "no se pudo armar el paquete");
      await registrar(ctx.directory, args.caso, {
        herramienta: "proveedor_armar_paquete",
        ok: false,
        resumen: err,
      });
      return fail(err);
    }
  },
};

async function asegurarFormulario(
  ctx: Ctx,
  caso: string,
  formato: string,
  dirCaso: string,
): Promise<void> {
  const nombre =
    formato === "xlsx"
      ? "formulario.xlsx"
      : formato === "pdf"
        ? "formulario.pdf"
        : "valores-portal.md";
  try {
    await fs.access(path.join(dirCaso, nombre));
  } catch {
    // No existe todavía: lo generamos llamando a la herramienta.
    await generar_formulario.execute({ caso }, ctx);
  }
}

async function copiarFormularioAlPaquete(
  formato: string,
  dirCaso: string,
  dirPaquete: string,
): Promise<void> {
  const nombre =
    formato === "xlsx"
      ? "formulario.xlsx"
      : formato === "pdf"
        ? "formulario.pdf"
        : "valores-portal.md";
  try {
    await fs.copyFile(
      path.join(dirCaso, nombre),
      path.join(dirPaquete, nombre),
    );
  } catch {
    // Si no se pudo generar, el checklist lo reflejará.
  }
}

async function escribirChecklist(
  dirPaquete: string,
  mapeo: Mapeo,
  soportes: EstadoSoporte[],
  bloqueo: { listo_para_firma: boolean; motivos: string[] },
  hoy: Date,
): Promise<void> {
  const l: string[] = [
    "# Checklist del paquete",
    "",
    `Fecha de evaluación: ${hoy.toISOString().slice(0, 10)}`,
    "",
    `**Listo para firma:** ${bloqueo.listo_para_firma ? "✅ Sí" : "❌ No"}`,
    "",
    "## Soportes",
    "",
    "| Soporte | Presente | Estado | Vigencia hasta |",
    "| --- | --- | --- | --- |",
  ];
  for (const s of soportes) {
    const estado = !s.presente ? "AUSENTE" : s.vencido ? "VENCIDO" : "vigente";
    l.push(
      `| ${s.tipo} | ${s.presente ? "sí" : "no"} | ${estado} | ${s.vigencia_hasta ?? "sin vencimiento"} |`,
    );
  }
  l.push("", "## Campos faltantes", "");
  if (mapeo.faltantes.length === 0) l.push("_Ninguno._");
  else for (const c of mapeo.faltantes) l.push(`- ${c.etiqueta} (${c.nota ?? ""})`);

  l.push("", "## Campos que requieren confirmación", "");
  if (mapeo.requiere_confirmacion.length === 0) l.push("_Ninguno._");
  else
    for (const c of mapeo.requiere_confirmacion)
      l.push(`- ${c.etiqueta} (${c.nota ?? ""})`);

  l.push("", "## Motivos de bloqueo", "");
  if (bloqueo.motivos.length === 0) l.push("_Ninguno._");
  else for (const m of bloqueo.motivos) l.push(`- ${m}`);

  await fs.writeFile(
    path.join(dirPaquete, "checklist.md"),
    l.join("\n") + "\n",
    "utf8",
  );
}

async function escribirBorradorCorreo(
  dirPaquete: string,
  cliente: string,
  exigidos: string[],
): Promise<void> {
  // RN2: nunca se incluyen datos bancarios en el correo.
  const l: string[] = [
    "# Borrador de correo",
    "",
    `**Para:** ${cliente}`,
    "**Asunto:** Registro como proveedor — Periferia IT Group S.A.S.",
    "",
    "Estimados,",
    "",
    "Adjuntamos el formulario de registro diligenciado junto con los soportes",
    "solicitados para su revisión. Quedamos atentos a cualquier observación.",
    "",
    "Soportes adjuntos solicitados:",
    "",
    ...exigidos.map((e) => `- ${e}`),
    "",
    "Cordialmente,",
    "Área Administrativa — Periferia IT Group S.A.S.",
  ];
  await fs.writeFile(
    path.join(dirPaquete, "borrador-correo.md"),
    l.join("\n") + "\n",
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// proveedor_simular_envio
// ---------------------------------------------------------------------------

export const simular_envio: Herramienta<{
  caso: z.ZodString;
  confirmado: z.ZodBoolean;
}> = {
  description:
    "Simula el envío del paquete. Solo escribe out/<caso>/ENVIO-SIMULADO.md si confirmado=true. Si no, devuelve error pidiendo confirmación explícita (RN4). Nunca envía nada real.",
  args: {
    caso: z
      .string()
      .describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
    confirmado: z
      .boolean()
      .describe(
        "Debe ser true y provenir de una confirmación explícita del usuario en el turno anterior.",
      ),
  },
  async execute(args, ctx) {
    try {
      if (!args.confirmado) {
        const err = "requiere confirmación explícita";
        await registrar(ctx.directory, args.caso, {
          herramienta: "proveedor_simular_envio",
          ok: false,
          resumen: err,
        });
        return fail(err);
      }
      if (!(await casoExiste(ctx.directory, args.caso))) {
        const err = `el caso "${args.caso}" no existe`;
        await registrar(ctx.directory, args.caso, {
          herramienta: "proveedor_simular_envio",
          ok: false,
          resumen: err,
        });
        return fail(err);
      }
      const dir = outCaso(ctx.directory, args.caso);
      await asegurarDir(dir);
      const ruta = path.join(dir, "ENVIO-SIMULADO.md");
      const contenido = [
        "# Envío simulado",
        "",
        `Caso: ${args.caso}`,
        `Confirmado por el usuario: sí`,
        `Fecha de simulación: ${new Date().toISOString()}`,
        "",
        "> Este archivo representa un envío simulado. En este reto no se realiza",
        "> ningún envío real al cliente.",
        "",
      ].join("\n");
      await fs.writeFile(ruta, contenido, "utf8");
      const rel = rutaRelativa(ctx.directory, ruta);
      await registrar(ctx.directory, args.caso, {
        herramienta: "proveedor_simular_envio",
        ok: true,
        resumen: `envío simulado escrito en ${rel}`,
      });
      return ok({ ruta: rel });
    } catch (e) {
      const err = mensajeError(e, "no se pudo simular el envío");
      await registrar(ctx.directory, args.caso, {
        herramienta: "proveedor_simular_envio",
        ok: false,
        resumen: err,
      });
      return fail(err);
    }
  },
};

/** Registro de todas las herramientas para el ciclo del agente. */
export const herramientas = {
  proveedor_leer_solicitud: leer_solicitud,
  proveedor_mapear_campos: mapear_campos,
  proveedor_generar_formulario: generar_formulario,
  proveedor_armar_paquete: armar_paquete,
  proveedor_simular_envio: simular_envio,
} as const;
