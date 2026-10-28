// Tipos del dominio del reto. Sin `any`.

export type Formato = "xlsx" | "pdf" | "portal";

export type Pais = "CO" | "EC" | "PE" | "PA" | "HN" | string;

/** Correo normalizado de un caso. */
export interface Solicitud {
  id: string;
  de: string;
  para?: string;
  asunto: string;
  fecha: string;
  pais: Pais;
  cliente: string;
  cuerpo: string;
  formato: Formato;
  adjuntos: string[];
}

/** Fila de una plantilla Excel. */
export interface CeldaPlantilla {
  hoja: string;
  celda_etiqueta: string;
  etiqueta: string;
  celda_valor: string;
}

/** Campo de una plantilla PDF o portal. */
export interface CampoPlantilla {
  etiqueta: string;
  obligatorio: boolean;
}

/** Soporte en el índice del repositorio. */
export interface Soporte {
  tipo: string;
  archivo: string;
  vigencia_hasta: string | null;
  pais_emisor: string;
  descripcion: string;
}

/** Glosario: etiqueta del cliente -> clave del maestro (notación de punto). */
export type Glosario = Record<string, string>;

/** Maestro: estructura libre en snake_case. */
export type Maestro = Record<string, unknown>;

/** Estado posible de un campo tras el mapeo. */
export type EstadoCampo = "lleno" | "faltante" | "requiere_confirmacion";

/** Un campo solicitado (normalizado desde la plantilla). */
export interface CampoSolicitado {
  etiqueta: string;
  obligatorio: boolean;
  /** Ubicación en Excel, si aplica. */
  hoja?: string;
  celda_etiqueta?: string;
  celda_valor?: string;
}

/** Resultado del mapeo de un campo. */
export interface CampoMapeado extends CampoSolicitado {
  estado: EstadoCampo;
  /** Clave de origen en el maestro (ej. "banco.nombre"), si se resolvió. */
  clave_maestro?: string;
  /** Valor obtenido del maestro, si existe. */
  valor?: string;
  /** Nota explicativa (ej. "identificador extranjero"). */
  nota?: string;
}

export interface Mapeo {
  llenos: CampoMapeado[];
  faltantes: CampoMapeado[];
  requiere_confirmacion: CampoMapeado[];
}

/** Resultado estándar de una herramienta. */
export type Resultado<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
