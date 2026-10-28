# Conocimiento del proceso — Registro como Proveedor

Este documento es el conocimiento de negocio que el agente consulta. No contiene
datos de la empresa (eso vive en `fixtures/reto-01/repositorio/maestro.json`) ni
el comportamiento conversacional (eso vive en `agent/prompt.md`). Describe **qué**
hace el proceso y **con qué reglas**.

## 1. Propósito

Automatizar el llenado de formularios de "registro como proveedor" que distintos
clientes envían por correo. La empresa proveedora es **Periferia IT Group S.A.S.**
(Colombia). El agente lee la solicitud, llena el formulario desde el repositorio
maestro, arma el paquete de soportes y deja todo listo para la firma humana del
representante legal. **El agente nunca firma ni envía**: solo prepara.

## 2. Entradas por caso

Cada caso vive en `fixtures/reto-01/casos/<caso>/`:

- `solicitud.json`: correo normalizado (`id`, `de`, `asunto`, `fecha`, `pais`,
  `cliente`, `cuerpo`, `formato`, `adjuntos[]`).
- `plantilla-celdas.json`: solo si `formato = xlsx`. Lista de
  `{ hoja, celda_etiqueta, etiqueta, celda_valor }`.
- `plantilla-campos.json`: solo si `formato = pdf` o `portal`. Lista ordenada de
  `{ etiqueta, obligatorio }`.
- `soportes-exigidos.json`: lista de tipos de soporte que el cliente exige.

## 3. Repositorio maestro

- `fixtures/reto-01/repositorio/maestro.json`: datos de la empresa en `snake_case`.
- `fixtures/reto-01/repositorio/soportes/index.json`: soportes con `tipo`,
  `archivo`, `vigencia_hasta` (puede ser `null`), `pais_emisor`, `descripcion`.
- `fixtures/reto-01/glosario-campos.json`: sinónimos (etiqueta del cliente) →
  clave del maestro (en notación de punto, ej. `banco.nombre`).

## 4. Estados de un campo

Cada campo solicitado termina en uno de tres estados:

- **lleno**: existe un valor en el maestro. Se guarda la ruta (clave) de origen
  para trazabilidad.
- **faltante**: la etiqueta no está en el glosario, o la clave resuelta no existe
  en el maestro. **Nunca se inventa un valor.**
- **requiere_confirmacion**: el mapeo tiene baja confianza o aplica una regla de
  país (ver RN1). El campo puede llevar un valor propuesto, pero necesita que un
  humano lo confirme.

## 5. Reglas de negocio

- **RN1 — Identificador tributario por país**: CO → NIT, EC → RUC, PE → RUC,
  PA → RUC, HN → RTN. La empresa solo tiene NIT colombiano. Para países distintos
  de CO, el campo de identificador tributario se llena con el NIT y se marca
  `requiere_confirmacion` con la nota "identificador extranjero".
- **RN2 — Datos bancarios**: se llenan solo si la plantilla los pide
  explícitamente. **Nunca** se incluyen en `borrador-correo.md`.
- **RN3 — Bloqueos de `listo_para_firma`**:
  - Un soporte exigido **ausente** del repositorio bloquea.
  - Un soporte exigido **vencido** (`vigencia_hasta` anterior a la fecha de
    ejecución) bloquea.
  - Un campo `faltante` **no** bloquea, pero aparece en el checklist.
  - Un campo obligatorio de la plantilla que quede `faltante` o
    `requiere_confirmacion` bloquea.
- **RN4 — Confirmación humana**: ninguna acción externa (envío, firma, carga a
  portal) se ejecuta sin una confirmación explícita del usuario en el turno
  inmediatamente anterior.
- **RN5 — Trazabilidad**: toda ejecución de herramienta deja un registro en
  `out/<caso>/log.jsonl` con `{ ts, herramienta, ok, resumen }`.

## 6. Formatos de salida

- **xlsx (P0)**: se escribe cada etiqueta y su valor en la hoja y celda indicadas
  por `plantilla-celdas.json`. Salida: `out/<caso>/formulario.xlsx`.
- **pdf (P1)**: se genera un PDF a partir de `plantilla-campos.json`, reproduciendo
  todos los campos con etiqueta y valor en el orden dado. Salida:
  `out/<caso>/formulario.pdf`.
- **portal (P2)**: no se implementa el llenado. El agente responde "formato no
  soportado" para la automatización y produce `out/<caso>/valores-portal.md` con
  los valores listos para copiar manualmente.

## 7. Paquete para firma

`out/<caso>/paquete/` contiene:
- El formulario generado (xlsx o pdf) o, para portal, `valores-portal.md`.
- Copias de los soportes exigidos que existan en el repositorio.
- `checklist.md`: soportes presentes / ausentes / vencidos, y campos faltantes.
- `borrador-correo.md`: correo de respuesta al cliente (sin datos bancarios, RN2).

El estado `listo_para_firma` es `true` solo si no hay bloqueos según RN3.

## 8. Simulación de envío

`proveedor_simular_envio` solo escribe `out/<caso>/ENVIO-SIMULADO.md` si recibe
`confirmado: true`. Si no, devuelve un error pidiendo confirmación explícita (RN4).
