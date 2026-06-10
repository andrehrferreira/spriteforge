import type { ChromaSettings } from './chroma'

/** ajuste fino de alinhamento por animação */
export interface AnimAlign {
  dx: number
  dy: number
  scale: number
}

export interface AnimationData {
  id: string
  name: string
  /** vídeo original — fica salvo no projeto para re-extração */
  video: Blob
  videoName: string
  extractFps: number
  maxDim: number
  chroma: ChromaSettings
  /** um booleano por frame extraído (faz parte do loop?) */
  selected: boolean[]
  crossfade: number
  fps: number
  align: AnimAlign
  thumb: Blob | null
}

/** pivô normalizado (0–1 dentro do conteúdo) + margem da célula */
export interface AlignCfg {
  pivotX: number
  pivotY: number
  margin: number
}

export interface ExportCfg {
  scale: number
  padding: number
  colors: number
  columns: number
}

export interface ProjectData {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  animations: AnimationData[]
  alignCfg: AlignCfg
  exportCfg: ExportCfg
}

export function newProject(id: string, name: string): ProjectData {
  return {
    id,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    animations: [],
    alignCfg: { pivotX: 0.5, pivotY: 1, margin: 8 },
    exportCfg: { scale: 1, padding: 0, colors: 256, columns: 0 },
  }
}
