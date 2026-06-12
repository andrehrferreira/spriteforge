import { describe, expect, it } from 'vitest'
import {
    centroidOf,
    detectAll,
    detectContinuity,
    detectDuplicates,
    detectPixels,
    detectProportion,
    detectQuantization,
    detectScale,
    detectTrim,
    diffPct,
    orphanCount,
    uniqueColorCount,
    type AnimInput,
    type CellInfo,
    type FrameSample,
} from '../src/analyze'
import { defaultSpritesCfg, type AlignCfg, type ExportCfg } from '../src/types'

/** amostra w×h preenchida por um pintor (x, y) → [r,g,b,a] */
function sample(
    w: number,
    h: number,
    paint: (x: number, y: number) => [number, number, number, number],
): FrameSample {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const [r, g, b, a] = paint(x, y)
            const i = (y * w + x) * 4
            data[i] = (r * a) / 255
            data[i + 1] = (g * a) / 255
            data[i + 2] = (b * a) / 255
            data[i + 3] = a
        }
    }
    return { w, h, data }
}

const opaque = (r: number, g: number, b: number): [number, number, number, number] => [r, g, b, 255]
const clear: [number, number, number, number] = [0, 0, 0, 0]

const cfg = defaultSpritesCfg()
const alignCfg: AlignCfg = { pivotX: 0.5, pivotY: 1, margin: 8 }
const exportCfg: ExportCfg = { scale: 1, padding: 0, colors: 256, columns: 0 }
const cell: CellInfo = { W: 100, H: 100, px: 50, py: 92 }

function anim(id: string, samples: FrameSample[], over: Partial<AnimInput> = {}): AnimInput {
    return {
        id,
        name: id,
        scale: 1,
        dx: 0,
        crossfade: 0,
        srcW: 100,
        bounds: { x: 10, y: 10, w: 80, h: 80 },
        samples,
        ...over,
    }
}

describe('métricas', () => {
    it('diffPct é 0 para amostras idênticas e 100 para totalmente diferentes', () => {
        const a = sample(4, 4, () => opaque(200, 0, 0))
        const b = sample(4, 4, () => opaque(200, 0, 0))
        const c = sample(4, 4, () => opaque(0, 0, 200))
        expect(diffPct(a, b, cfg.pixelDiffThreshold)).toBe(0)
        expect(diffPct(a, c, cfg.pixelDiffThreshold)).toBe(100)
    })

    it('centroidOf encontra o único pixel visível', () => {
        const s = sample(8, 8, (x, y) => (x === 2 && y === 5 ? opaque(255, 255, 255) : clear))
        const c = centroidOf(s)
        expect(c.x).toBe(2)
        expect(c.y).toBe(5)
        expect(c.m).toBeGreaterThan(0)
    })

    it('orphanCount conta pixel isolado e ignora pixel acompanhado', () => {
        const lone = sample(8, 8, (x, y) => (x === 4 && y === 4 ? opaque(255, 0, 0) : clear))
        const pair = sample(8, 8, (x, y) => ((x === 4 || x === 5) && y === 4 ? opaque(255, 0, 0) : clear))
        expect(orphanCount(lone)).toBe(1)
        expect(orphanCount(pair)).toBe(0)
    })

    it('uniqueColorCount distingue cores quantizadas', () => {
        const s = sample(4, 4, (x) => (x < 2 ? opaque(255, 0, 0) : opaque(0, 0, 255)))
        expect(uniqueColorCount([s])).toBe(2)
    })
})

describe('detectores', () => {
    it('detectDuplicates aponta frames consecutivos idênticos e estima economia', () => {
        const a = sample(6, 6, () => opaque(100, 100, 100))
        const b = sample(6, 6, () => opaque(100, 100, 100))
        const c = sample(6, 6, () => opaque(0, 200, 0))
        const d = sample(6, 6, () => opaque(200, 0, 200))
        const out = detectDuplicates([anim('run', [a, b, c, d])], cfg, 1000)
        expect(out).toHaveLength(1)
        expect(out[0].target.frames).toEqual([1])
        expect(out[0].savingsBytes).toBe(1000)
    })

    it('detectDuplicates nunca remove a ponto de restar menos de 2 frames', () => {
        const a = sample(6, 6, () => opaque(100, 100, 100))
        const out = detectDuplicates([anim('x', [a, a, a])], cfg, 100)
        expect(out).toHaveLength(0) // removeria 2 de 3 (1 consecutivo + emenda) → bloqueado
    })

    it('detectProportion sinaliza a animação fora da mediana com o fator de ajuste', () => {
        const s = sample(4, 4, () => opaque(50, 50, 50))
        const inputs = [
            anim('a', [s], { bounds: { x: 0, y: 0, w: 50, h: 100 } }),
            anim('b', [s], { bounds: { x: 0, y: 0, w: 50, h: 100 } }),
            anim('c', [s], { bounds: { x: 0, y: 0, w: 50, h: 200 } }),
        ]
        const out = detectProportion(inputs, cfg)
        expect(out).toHaveLength(1)
        expect(out[0].target.animId).toBe('c')
        expect(out[0].params.escala).toBe(0.5)
    })

    it('detectContinuity sinaliza emenda dura apenas sem crossfade', () => {
        const frames = [
            sample(6, 6, () => opaque(10, 10, 10)),
            sample(6, 6, () => opaque(12, 12, 12)),
            sample(6, 6, () => opaque(14, 14, 14)),
            sample(6, 6, () => opaque(255, 255, 255)), // último ≠ primeiro → emenda dura
        ]
        expect(detectContinuity([anim('run', frames)], cfg)).toHaveLength(1)
        expect(detectContinuity([anim('run', frames, { crossfade: 3 })], cfg)).toHaveLength(0)
    })

    it('detectTrim propõe reduzir margens grandes', () => {
        expect(detectTrim(cell, 24, 100000)).toHaveLength(1)
        expect(detectTrim(cell, 8, 100000)).toHaveLength(0)
    })

    it('detectQuantization propõe 256 sem paleta e 128 com poucas cores', () => {
        const s = sample(4, 4, () => opaque(255, 0, 0))
        expect(
            detectQuantization([anim('a', [s])], { ...exportCfg, colors: -1 }, 1000)[0]?.params.cores,
        ).toBe(256)
        expect(
            detectQuantization([anim('a', [s])], { ...exportCfg, colors: 256 }, 1000)[0]?.params.cores,
        ).toBe(128)
    })

    it('detectScale só dispara para células grandes', () => {
        expect(detectScale({ W: 1000, H: 1000, px: 500, py: 920 }, exportCfg, 1000)).toHaveLength(1)
        expect(detectScale({ W: 400, H: 400, px: 200, py: 368 }, exportCfg, 1000)).toHaveLength(0)
    })

    it('detectPixels sinaliza pixels órfãos recorrentes', () => {
        const noisy = sample(12, 12, (x, y) =>
            (x === 2 && y === 2) || (x === 8 && y === 3) || (x === 5 && y === 9) ? opaque(0, 255, 0) : clear,
        )
        const out = detectPixels([anim('fx', [noisy, noisy])])
        expect(out).toHaveLength(1)
        expect(out[0].params.alfa).toBe(24)
    })
})

describe('detectAll', () => {
    it('é determinístico: mesma entrada produz a mesma saída, na mesma ordem', () => {
        const frames = [
            sample(8, 8, () => opaque(80, 80, 80)),
            sample(8, 8, () => opaque(80, 80, 80)),
            sample(8, 8, () => opaque(0, 0, 0)),
            sample(8, 8, () => opaque(250, 250, 250)),
        ]
        const inputs = [anim('a', frames), anim('b', frames, { bounds: { x: 0, y: 0, w: 50, h: 220 } })]
        const r1 = detectAll(inputs, cell, alignCfg, exportCfg, cfg)
        const r2 = detectAll(inputs, cell, alignCfg, exportCfg, cfg)
        expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
    })

    it('ids são determinísticos por categoria e alvo', () => {
        const frames = [sample(8, 8, () => opaque(80, 80, 80)), sample(8, 8, () => opaque(81, 81, 81))]
        const out = detectAll([anim('a', frames)], cell, alignCfg, { ...exportCfg, colors: -1 }, cfg)
        for (const c of out) {
            expect(c.id).toBe(`${c.kind}:${c.target.animId ?? 'projeto'}`)
            expect(c.accepted).toBe(false)
        }
    })
})
