import { describe, expect, it } from 'vitest'
import { buildIconManifest, type AtlasIconMeta } from '../src/atlas'

describe('buildIconManifest', () => {
  const icons: AtlasIconMeta[] = [
    { name: 'gens_001', x: 0, y: 0, w: 64, h: 64 },
    { name: 'swords_003', x: 64, y: 0, w: 64, h: 64 },
    { name: 'gens_002', x: 32, y: 128, w: 128, h: 128 },
  ]

  it('gera o manifesto com meta e posições corretas', () => {
    const m = JSON.parse(
      buildIconManifest(
        { name: 'icones', width: 256, height: 256, cell: 128, padding: 0, columns: 2, rows: 2, compression: 'paleta-256-cores' },
        icons,
      ),
    ) as {
      meta: { image: string; size: { w: number }; cell: number; count: number; tool: string }
      icons: AtlasIconMeta[]
    }
    expect(m.meta.tool).toBe('atlas')
    expect(m.meta.image).toBe('icones.png')
    expect(m.meta.size.w).toBe(256)
    expect(m.meta.cell).toBe(128)
    expect(m.meta.count).toBe(3)
    expect(m.icons).toHaveLength(3)
    expect(m.icons[2]).toEqual({ name: 'gens_002', x: 32, y: 128, w: 128, h: 128 })
  })

  it('atlas vazio é serializável', () => {
    const m = JSON.parse(
      buildIconManifest(
        { name: 'vazio', width: 64, height: 64, cell: 64, padding: 0, columns: 1, rows: 1, compression: 'rgba32-otimizado' },
        [],
      ),
    ) as { meta: { count: number }; icons: unknown[] }
    expect(m.meta.count).toBe(0)
    expect(m.icons).toEqual([])
  })
})
