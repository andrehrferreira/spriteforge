import { describe, expect, it } from 'vitest'
import { buildManifest, computeLayout, formatBytes, slugify, uniqueSlug } from '../src/export'
import type { SheetAnimMeta } from '../src/types'

describe('slugs', () => {
  it('slugify normaliza acentos, espaços e maiúsculas', () => {
    expect(slugify('Ataque Mágico!')).toBe('ataque_magico')
    expect(slugify('  ')).toBe('sprite')
  })

  it('uniqueSlug desambigua colisões com sufixo incremental', () => {
    const used = new Set<string>()
    expect(uniqueSlug('Run', used)).toBe('run')
    expect(uniqueSlug('run', used)).toBe('run_2')
    expect(uniqueSlug('rún', used)).toBe('run_3')
  })
})

describe('computeLayout', () => {
  it('grade ≈ quadrada com colunas automáticas', () => {
    const l = computeLayout(12, 100, 50, { scale: 1, padding: 0, columns: 0 })
    expect(l.cols).toBe(4)
    expect(l.rows).toBe(3)
    expect(l.width).toBe(400)
    expect(l.height).toBe(150)
  })

  it('aplica escala e padding nas dimensões', () => {
    const l = computeLayout(2, 100, 100, { scale: 0.5, padding: 2, columns: 2 })
    expect(l.cellW).toBe(50)
    expect(l.width).toBe(2 * 50 + 3 * 2)
  })
})

describe('buildManifest', () => {
  const am: SheetAnimMeta = {
    animId: 'a1',
    name: 'Run',
    slug: 'run',
    frameCount: 3,
    fps: 23,
    crossfade: 2,
    columns: 2,
    rows: 2,
    width: 204,
    height: 204,
    cellW: 100,
    cellH: 100,
    durationsMs: [43, 86, 43],
    keptPositions: [0, 1, 3],
  }
  const sheet = {
    version: 5,
    createdAt: 1765000000000,
    cell: { w: 100, h: 100, pivotX: 0.5, pivotY: 1, margin: 8 },
    exportCfg: { scale: 1, padding: 2, colors: 256, columns: 0 },
    corrections: [],
    anims: [am],
  }

  it('gera meta.version 4 com a versão de geração separada', () => {
    const m = JSON.parse(buildManifest('Herói', sheet)) as {
      meta: { version: number; generation: number; pivot: { x: number; y: number } }
    }
    expect(m.meta.version).toBe(4)
    expect(m.meta.generation).toBe(5)
    expect(m.meta.pivot).toEqual({ x: 0.5, y: 1 })
  })

  it('frames carregam coordenadas da grade e durações individuais', () => {
    const m = JSON.parse(buildManifest('Herói', sheet)) as {
      animations: Record<string, { image: string; frames: { x: number; y: number; duration_ms: number }[] }>
    }
    const run = m.animations.run
    expect(run.image).toBe('heroi_run.png')
    expect(run.frames).toHaveLength(3)
    expect(run.frames[0]).toMatchObject({ x: 2, y: 2, duration_ms: 43 })
    expect(run.frames[1]).toMatchObject({ x: 104, y: 2, duration_ms: 86 })
    expect(run.frames[2]).toMatchObject({ x: 2, y: 104, duration_ms: 43 })
  })
})

describe('formatBytes', () => {
  it('formata B, KB e MB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
  })
})
