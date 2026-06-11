import { describe, expect, it } from 'vitest'
import { animStateHash } from '../src/state'
import { newProject, type AnimationData } from '../src/types'

function makeAnim(id: string): AnimationData {
  return {
    id,
    name: id,
    video: new Blob(['x']),
    videoName: `${id}.mp4`,
    extractFps: 23,
    maxDim: 720,
    chroma: { enabled: true, key: [0, 177, 64], similarity: 0.054, smoothness: 0.202, spill: 0.225, halo: 0.312 },
    selected: [true, true, false, true],
    speed: [1, 1.5, 1, 1],
    curve: [{ t: 0, v: 1 }, { t: 1, v: 1 }],
    drift: null,
    crossfade: 2,
    fps: 23,
    align: { dx: 0, dy: 0, scale: 1 },
    thumb: null,
  }
}

describe('animStateHash (detecção de stale)', () => {
  it('é estável para o mesmo estado', () => {
    const p = newProject('p1', 'teste')
    p.animations.push(makeAnim('a'))
    expect(animStateHash(p)).toBe(animStateHash(p))
  })

  it('muda quando o chroma, a seleção ou o alinhamento mudam', () => {
    const p = newProject('p1', 'teste')
    p.animations.push(makeAnim('a'))
    const base = animStateHash(p)

    p.animations[0].chroma.similarity = 0.1
    const afterChroma = animStateHash(p)
    expect(afterChroma).not.toBe(base)

    p.animations[0].selected[2] = true
    const afterSelection = animStateHash(p)
    expect(afterSelection).not.toBe(afterChroma)

    p.alignCfg.margin = 16
    expect(animStateHash(p)).not.toBe(afterSelection)
  })

  it('não muda com campos irrelevantes para a geração (nome do projeto)', () => {
    const p = newProject('p1', 'teste')
    p.animations.push(makeAnim('a'))
    const base = animStateHash(p)
    p.name = 'outro nome'
    expect(animStateHash(p)).toBe(base)
  })
})
