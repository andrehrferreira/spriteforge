import type { ChromaSettings } from './chroma'

/** ponto de controle da curva de fps (t = posição no loop 0–1, v = multiplicador) */
export interface CurvePoint {
  t: number
  v: number
}

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
  /** multiplicador de velocidade por frame extraído (amostrado da curva; 1 = normal) */
  speed: number[]
  /** pontos de controle da curva de fps */
  curve: CurvePoint[]
  /** deriva de posição acumulada num ciclo do loop (px, corrigida na composição) */
  drift?: { x: number; y: number } | null
  crossfade: number
  fps: number
  align: AnimAlign
  /** incluir esta animação na exportação do atlas? (ausente = sim, p/ projetos antigos) */
  exportEnabled?: boolean
  thumb: Blob | null
}

/** pivô normalizado (0–1 dentro do conteúdo) + margem da célula */
/** imagem de referência do personagem, salva no projeto */
export interface ProjectRef {
  id: string
  name: string
  blob: Blob
}

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
  refs: ProjectRef[]
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
    refs: [],
    alignCfg: { pivotX: 0.5, pivotY: 1, margin: 8 },
    exportCfg: { scale: 1, padding: 0, colors: 256, columns: 0 },
  }
}
