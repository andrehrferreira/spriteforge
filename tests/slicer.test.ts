import { describe, expect, it } from 'vitest'
import { componentBoxes, expandBoxes, fitRect, mergeBoxes, sortReadingOrder, splitOversized, tightenBox, type Box } from '../src/slicer'

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

describe('expandBoxes', () => {
  it('expande pela folga e trava na metade do vão até o vizinho', () => {
    const boxes: Box[] = [
      { x: 10, y: 10, w: 20, h: 20 },
      { x: 50, y: 10, w: 20, h: 20 }, // vão de 20px entre elas
    ]
    const out = expandBoxes(boxes, 200, 200, 50)
    // lado interno: metade do vão (10); lados livres: folga inteira (clampada na folha)
    expect(out[0]).toEqual({ x: 0, y: 0, w: 40, h: 80 })
    expect(out[1]).toEqual({ x: 40, y: 0, w: 80, h: 80 })
  })

  it('caixas que se tocam não invadem nem encolhem', () => {
    const boxes: Box[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 10, y: 0, w: 10, h: 10 },
    ]
    const out = expandBoxes(boxes, 100, 100, 8)
    expect(out[0].x + out[0].w).toBeLessThanOrEqual(out[1].x)
    expect(out[0].w).toBeGreaterThanOrEqual(10)
  })

  it('respeita os limites da folha', () => {
    const out = expandBoxes([{ x: 2, y: 2, w: 10, h: 10 }], 20, 20, 50)
    expect(out[0]).toEqual({ x: 0, y: 0, w: 20, h: 20 })
  })
})

describe('splitOversized', () => {
  /** máscara com dois blocos densos ligados por uma ponte fina */
  function bridged(): { mask: Uint8Array; w: number; h: number } {
    const w = 120
    const h = 40
    const mask = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const leftBlob = x >= 2 && x < 50
        const rightBlob = x >= 70 && x < 118
        const bridge = y === 20 && x >= 50 && x < 70 // 1px de aura conectando
        if (leftBlob || rightBlob || bridge) mask[y * w + x] = 1
      }
    }
    return { mask, w, h }
  }

  it('corta um componente gigante no vale do perfil', () => {
    const { mask, w } = bridged()
    // caixa única gigante + duas caixas normais para ancorar a mediana
    const giant: Box = { x: 2, y: 0, w: 116, h: 40 }
    const anchors: Box[] = [
      { x: 0, y: 0, w: 48, h: 40 },
      { x: 0, y: 0, w: 48, h: 40 },
    ]
    const out = splitOversized([giant, ...anchors], mask, w)
    expect(out.length).toBe(4) // gigante virou 2 + as 2 âncoras
    const widths = out.map((b) => b.w).sort((a, b) => a - b)
    expect(widths.every((wd) => wd <= 60)).toBe(true)
  })

  it('não corta caixas dentro do tamanho típico', () => {
    const { mask, w } = bridged()
    const boxes: Box[] = [
      { x: 2, y: 0, w: 48, h: 40 },
      { x: 70, y: 0, w: 48, h: 40 },
      { x: 2, y: 0, w: 48, h: 40 },
    ]
    expect(splitOversized(boxes, mask, w)).toHaveLength(3)
  })
})

describe('tightenBox', () => {
  it('encolhe a caixa para o conteúdo real e devolve null quando vazia', () => {
    const { alpha, w } = mask([
      '......',
      '..##..',
      '..##..',
      '......',
    ])
    expect(tightenBox(alpha, w, { x: 0, y: 0, w: 6, h: 4 })).toEqual({ x: 2, y: 1, w: 2, h: 2 })
    expect(tightenBox(alpha, w, { x: 0, y: 0, w: 2, h: 1 })).toBeNull()
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
