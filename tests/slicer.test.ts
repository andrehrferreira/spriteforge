import { describe, expect, it } from 'vitest'
import { componentBoxes, fitRect, mergeBoxes, sortReadingOrder, type Box } from '../src/slicer'

/** máscara w×h a partir de linhas de '.' e '#' */
function mask(rows: string[]): { alpha: Uint8Array; w: number; h: number } {
  const h = rows.length
  const w = rows[0].length
  const alpha = new Uint8Array(w * h)
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) alpha[y * w + x] = row[x] === '#' ? 1 : 0
  })
  return { alpha, w, h }
}

describe('componentBoxes', () => {
  it('encontra dois blobs separados com as caixas certas', () => {
    const { alpha, w, h } = mask([
      '##....',
      '##....',
      '....##',
      '....##',
    ])
    const boxes = componentBoxes(alpha, w, h, 1)
    expect(boxes).toHaveLength(2)
    expect(boxes).toContainEqual({ x: 0, y: 0, w: 2, h: 2 })
    expect(boxes).toContainEqual({ x: 4, y: 2, w: 2, h: 2 })
  })

  it('8-conectividade une diagonais e área mínima filtra ruído', () => {
    const { alpha, w, h } = mask([
      '#.....',
      '.#....',
      '......',
      '....#.',
    ])
    // diagonal une os dois primeiros; o pixel solto (área 1) é filtrado
    const boxes = componentBoxes(alpha, w, h, 2)
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toEqual({ x: 0, y: 0, w: 2, h: 2 })
  })
})

describe('mergeBoxes', () => {
  it('funde caixas dentro da distância e mantém as distantes', () => {
    const boxes: Box[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 14, y: 0, w: 10, h: 10 }, // 4px de vão
      { x: 60, y: 0, w: 10, h: 10 },
    ]
    const out = mergeBoxes(boxes, 6)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ x: 0, y: 0, w: 24, h: 10 })
  })

  it('com distância 0 não funde caixas separadas', () => {
    const out = mergeBoxes([{ x: 0, y: 0, w: 4, h: 4 }, { x: 6, y: 0, w: 4, h: 4 }], 0)
    expect(out).toHaveLength(2)
  })
})

describe('sortReadingOrder', () => {
  it('ordena por linhas e depois por coluna', () => {
    const out = sortReadingOrder([
      { x: 50, y: 52, w: 10, h: 10 }, // linha 2, col 2
      { x: 0, y: 0, w: 10, h: 10 },   // linha 1, col 1
      { x: 0, y: 50, w: 10, h: 10 },  // linha 2, col 1
      { x: 50, y: 2, w: 10, h: 10 },  // linha 1, col 2 (levemente desalinhada)
    ])
    expect(out.map((b) => [b.x, b.y])).toEqual([[0, 0], [50, 2], [0, 50], [50, 52]])
  })
})

describe('fitRect', () => {
  it('preserva proporção e centraliza com margem', () => {
    const f = fitRect({ x: 0, y: 0, w: 200, h: 100 }, 64, 0)
    expect(f.dw).toBe(64)
    expect(f.dh).toBe(32)
    expect(f.dx).toBe(0)
    expect(f.dy).toBe(16)
  })

  it('aplica a margem interna', () => {
    const f = fitRect({ x: 0, y: 0, w: 100, h: 100 }, 64, 12.5) // margem 8px
    expect(f.dw).toBe(48)
    expect(f.dx).toBe(8)
  })
})
