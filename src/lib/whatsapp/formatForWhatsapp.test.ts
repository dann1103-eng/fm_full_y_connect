import { describe, it, expect } from 'vitest'
import { sanitizeForWhatsapp } from './formatForWhatsapp'

describe('sanitizeForWhatsapp', () => {
  it('colapsa negrita doble ** → * (una y varias por línea)', () => {
    expect(sanitizeForWhatsapp('Esto es **negrita**')).toBe('Esto es *negrita*')
    expect(sanitizeForWhatsapp('**a** y **b**')).toBe('*a* y *b*')
    expect(sanitizeForWhatsapp('__también__')).toBe('*también*')
  })

  it('convierte encabezados ## en negrita simple, pero no toca #hashtag', () => {
    expect(sanitizeForWhatsapp('## Título')).toBe('*Título*')
    expect(sanitizeForWhatsapp('#hashtag sin espacio')).toBe('#hashtag sin espacio')
  })

  it('normaliza viñetas * / + a - sin confundir negrita inline', () => {
    expect(sanitizeForWhatsapp('* item uno')).toBe('- item uno')
    expect(sanitizeForWhatsapp('+ item dos')).toBe('- item dos')
    expect(sanitizeForWhatsapp('mira *esto* inline')).toBe('mira *esto* inline')
  })

  it('convierte una tabla markdown real en líneas "Etiqueta: valor"', () => {
    const input = ['| Fase | Cantidad |', '|---|---|', '| Aprobado | 2 |', '| Publicado | 1 |'].join('\n')
    expect(sanitizeForWhatsapp(input)).toBe('Aprobado: 2\nPublicado: 1')
  })

  it('NO destruye texto legítimo con un pipe seguido de guiones (falso positivo de tabla)', () => {
    const input = 'Opción 1 | Opción 2\n-- | --'
    // Sin filas de datos → no es tabla real → se conserva el texto.
    expect(sanitizeForWhatsapp(input)).toBe('Opción 1 | Opción 2\n-- | --')
  })

  it('conserva una línea suelta con un pipe (sin separador)', () => {
    expect(sanitizeForWhatsapp('café | té | agua')).toBe('café | té | agua')
  })

  it('respeta bloques de código ``` sin transformar su contenido', () => {
    const input = '```\ncodigo | pipe\n--- | ---\n```'
    expect(sanitizeForWhatsapp(input)).toBe('```\ncodigo | pipe\n--- | ---\n```')
  })

  it('no emite basura ":" para filas de tabla totalmente vacías', () => {
    const input = ['| A | B |', '|---|---|', '|  |  |'].join('\n')
    expect(sanitizeForWhatsapp(input)).not.toContain(':')
  })

  it('deja el texto plano intacto', () => {
    const input = 'Hola, tu contenido va bien. ¿Necesitas algo más?'
    expect(sanitizeForWhatsapp(input)).toBe(input)
  })
})
