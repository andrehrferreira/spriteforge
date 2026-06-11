/**
 * Estado da sessão: projeto aberto + cache em memória dos frames extraídos
 * (por id de animação — os bitmaps não vão para o IndexedDB).
 */

import { putProject } from './db'
import { extractFrames, type ExtractedFrame } from './extract'
import type { AnimationData, ProjectData } from './types'

export const state = {
  project: null as ProjectData | null,
  frames: new Map<string, ExtractedFrame[]>(),
}

export function openProjectState(p: ProjectData): void {
  if (!Array.isArray(p.refs)) p.refs = [] // projetos antigos não têm referências
  state.project = p
  state.frames.clear()
}

export async function saveProject(): Promise<void> {
  if (!state.project) return
  state.project.updatedAt = Date.now()
  await putProject(state.project)
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
