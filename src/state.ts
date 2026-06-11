/**
 * Estado da sessão: projeto aberto + cache em memória dos frames extraídos
 * (por id de animação — os bitmaps não vão para o IndexedDB).
 */

import { scheduleBackup } from './backup'
import { putProject } from './db'
import { extractFrames, type ExtractedFrame } from './extract'
import { defaultSpritesCfg, type AnimationData, type ProjectData } from './types'

export const state = {
  project: null as ProjectData | null,
  frames: new Map<string, ExtractedFrame[]>(),
}

export function openProjectState(p: ProjectData): void {
  // backfill para projetos salvos antes destes campos existirem
  if (!Array.isArray(p.refs)) p.refs = []
  if (!p.spritesCfg) p.spritesCfg = defaultSpritesCfg()
  state.project = p
  state.frames.clear()
}

/**
 * Hash do estado relevante das animações + alinhamento. Um spritesheet salvo
 * com hash diferente do atual está desatualizado (stale) e precisa regerar.
 */
export function animStateHash(p: ProjectData): string {
  const parts: (string | number)[] = [p.alignCfg.pivotX, p.alignCfg.pivotY, p.alignCfg.margin]
  for (const a of p.animations) {
    parts.push(
      a.id,
      a.videoName,
      a.extractFps,
      a.maxDim,
      a.fps,
      a.crossfade,
      a.selected.map((s) => (s ? 1 : 0)).join(''),
      a.speed.join(','),
      a.curve.map((c) => `${c.t}:${c.v}`).join(','),
      a.chroma.enabled ? 1 : 0,
      a.chroma.key.join(','),
      a.chroma.similarity,
      a.chroma.smoothness,
      a.chroma.spill,
      a.chroma.halo,
      a.align.dx,
      a.align.dy,
      a.align.scale,
      a.drift ? `${a.drift.x},${a.drift.y}` : '',
    )
  }
  const s = parts.join('|')
  let h = 5381 // djb2
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(16)
}

export async function saveProject(): Promise<void> {
  if (!state.project) return
  state.project.updatedAt = Date.now()
  await putProject(state.project)
  scheduleBackup(state.project)
}

/** Garante os frames extraídos da animação (extrai do vídeo salvo se preciso). */
export async function ensureFrames(
  anim: AnimationData,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractedFrame[]> {
  const cached = state.frames.get(anim.id)
  if (cached) return cached
  const res = await extractFrames(anim.video, anim.extractFps, anim.maxDim, onProgress ?? (() => {}))
  // reconcilia a seleção e a curva salvas com a contagem extraída
  if (anim.selected.length !== res.frames.length) {
    anim.selected = res.frames.map((_, i) => anim.selected[i] ?? true)
  }
  const oldSpeed: number[] = anim.speed ?? [] // projetos antigos não têm a curva
  if (oldSpeed.length !== res.frames.length) {
    anim.speed = res.frames.map((_, i) => oldSpeed[i] ?? 1)
  }
  if (!Array.isArray(anim.curve) || anim.curve.length < 2) {
    anim.curve = [{ t: 0, v: 1 }, { t: 1, v: 1 }]
  }
  state.frames.set(anim.id, res.frames)
  return res.frames
}

/** bitmaps cheios dos frames selecionados, na ordem */
export function selectedBitmaps(anim: AnimationData, frames: ExtractedFrame[]): ImageBitmap[] {
  return frames.filter((_, i) => anim.selected[i]).map((f) => f.full)
}
