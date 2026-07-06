/**
 * Convierte el markdown "estándar" que Claude produce por defecto al dialecto
 * que WhatsApp SÍ renderiza:
 *   - Negrita: *un asterisco*  (NO **doble**)
 *   - Cursiva: _así_ · Tachado: ~así~ · Monoespaciado: ```así```
 * WhatsApp NO soporta **doble asterisco**, encabezados markdown (#) ni tablas (| a | b |).
 *
 * Es CONSERVADOR: solo transforma lo que INEQUÍVOCAMENTE es markdown. Ante la
 * duda deja el texto igual — nunca borra contenido legítimo:
 *   - Solo trata algo como tabla si hay header + separador de guiones con el
 *     MISMO número de celdas Y al menos una fila de datos.
 *   - Respeta bloques de código ``` (pasa su contenido sin tocar).
 *
 * Red de seguridad en la ruta de envío: aunque el prompt instruya el formato,
 * los modelos se desvían a veces; este saneo garantiza el resultado.
 */
export function sanitizeForWhatsapp(input: string): string {
  if (!input) return input
  const lines = input.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    // Bloques de código ```: alternar estado y pasar el contenido SIN transformar.
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }

    // ¿Tabla markdown REAL? header con pipes, separador de guiones con el mismo
    // número de celdas, y ≥1 fila de datos. Si falta cualquiera, NO es tabla y
    // las líneas se tratan como texto normal (nunca se descartan).
    if (
      looksLikeTableRow(line) &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1]!) &&
      countCells(line) >= 2 &&
      countCells(line) === countCells(lines[i + 1]!)
    ) {
      const dataRows: string[] = []
      let j = i + 2
      while (j < lines.length && looksLikeTableRow(lines[j]!) && !isTableSeparator(lines[j]!)) {
        dataRows.push(lines[j]!)
        j++
      }
      if (dataRows.length > 0) {
        for (const dr of dataRows) {
          const rendered = renderTableRow(dr)
          if (rendered) out.push(rendered)
        }
        i = j - 1
        continue
      }
      // Sin filas de datos → falso positivo; caer a texto normal (abajo).
    }

    out.push(transformInline(line))
  }

  return out
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Transforma encabezados, viñetas y negrita doble dentro de una línea. */
function transformInline(line: string): string {
  let s = line
  const heading = s.match(/^\s*#{1,6}\s+(.*\S)\s*$/)
  if (heading) {
    s = `*${heading[1]}*` // "## Título" → "*Título*" (énfasis nativo)
  } else {
    s = s.replace(/^(\s*)[*+]\s+/, '$1- ') // viñeta "* item" / "+ item" → "- item"
  }
  // Negrita doble → simple. **x** y __x__ → *x*
  s = s.replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/__(.+?)__/g, '*$1*')
  return s
}

function looksLikeTableRow(line: string): boolean {
  const t = line.trim()
  return t.length > 1 && t.includes('|')
}

/** Solo es separador si CADA celda es guiones (con dos-puntos de alineación opcionales). */
function isTableSeparator(line: string): boolean {
  const t = line.trim()
  if (!t.includes('-')) return false
  const cells = splitRawCells(line)
  return cells.length > 0 && cells.every((c) => /^\s*:?-+:?\s*$/.test(c))
}

function countCells(line: string): number {
  return splitRawCells(line).length
}

/** Parte una fila por '|' descartando pipes de borde, SIN transformar celdas. */
function splitRawCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|')
}

function renderTableRow(line: string): string {
  const cells = splitRawCells(line).map((c) => transformInline(c.trim()))
  if (cells.every((c) => c === '')) return '' // fila totalmente vacía → nada
  if (cells.length === 2) return `${cells[0]}: ${cells[1]}`.trim()
  return cells.join(' · ')
}
