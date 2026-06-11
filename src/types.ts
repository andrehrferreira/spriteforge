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

/** categorias de correção propostas pela análise da área SPRITES */
export type CorrectionKind =
  | 'proporcao'
  | 'posicao'
  | 'duplicados'
  | 'continuidade'
  | 'recorte'
  | 'quantizacao'
  | 'escala'
  | 'pixel'

export type CorrectionSeverity = 'info' | 'aviso' | 'critico'

export interface CorrectionTarget {
  scope: 'projeto' | 'animacao' | 'frame'
  animId?: string
  /** posições do loop afetadas (escopo frame) */
  frames?: number[]
}

/**
 * Proposta de correção da análise. NÃO destrutiva: aceitar uma proposta só
 * afeta a geração do atlas — nunca altera AnimationData/selected/bitmaps.
 */
export interface Correction {
  /** id determinístico: `${kind}:${animId ?? 'projeto'}` */
  id: string
  kind: CorrectionKind
  severity: CorrectionSeverity
  target: CorrectionTarget
  /** descrição em pt-BR exibida na UI */
  label: string
  /** economia estimada em bytes, quando aplicável */
  savingsBytes?: number
  /** parâmetros aplicáveis, ajustáveis pelo usuário antes de gerar */
  params: Record<string, number>
  accepted: boolean
  /** true quando o usuário alterou os params propostos */
  adjusted: boolean
}

/** limiares da análise da área SPRITES */
export interface SpritesCfg {
  /** soma |ΔR|+|ΔG|+|ΔB|+|ΔA| (premultiplicado, 0–1020) que conta como pixel diferente */
  pixelDiffThreshold: number
  /** % de pixels diferentes abaixo do qual frames consecutivos são duplicados */
  dupThresholdPct: number
  /** % de pixels diferentes acima do qual há descontinuidade entre frames */
  continuityThresholdPct: number
  /** divergência de proporção entre animações que dispara proposta (fração) */
  proportionTolerance: number
  /** desvio de centroide (px na origem) que dispara ajuste de posição */
  positionTolerancePx: number
}

export function defaultSpritesCfg(): SpritesCfg {
  return {
    pixelDiffThreshold: 60,
    dupThresholdPct: 0.5,
    continuityThresholdPct: 45,
    proportionTolerance: 0.12,
    positionTolerancePx: 6,
  }
}

/** metadados por animação dentro de um spritesheet gerado */
export interface SheetAnimMeta {
  animId: string
  name: string
  slug: string
  frameCount: number
  fps: number
  crossfade: number
  columns: number
  rows: number
  /** dimensões do atlas da animação */
  width: number
  height: number
  /** célula escalada usada no atlas */
  cellW: number
  cellH: number
  /** duração de cada frame mantido (duplicados removidos somam no anterior) */
  durationsMs: number[]
  /** posições do loop mantidas após remoção de duplicados */
  keptPositions: number[]
}

/** uma geração persistida no store IndexedDB `spritesheets` */
export interface SpriteSheet {
  id: string
  projectId: string
  /** versão de GERAÇÃO (incremental por projeto) */
  version: number
  createdAt: number
  cell: { w: number; h: number; pivotX: number; pivotY: number; margin: number }
  exportCfg: ExportCfg
  /** correções aceitas na geração, com os params finais (ajustados) */
  corrections: Correction[]
  anims: SheetAnimMeta[]
  /** PNG por animação, alinhado com `anims` */
  blobs: Blob[]
  /** hash do estado das animações na geração (detecção de stale) */
  stateHash: string
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
  spritesCfg: SpritesCfg
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
    spritesCfg: defaultSpritesCfg(),
  }
}
