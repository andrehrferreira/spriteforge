/**
 * Orquestração: home (projetos) → projeto (animações) → editor / alinhamento.
 */

import './style.css'
import { initAlign } from './align'
import { initGenVideo } from './genvideo'
import { initNormalize } from './normalize'
import { initSprites } from './sprites'
import { DEFAULT_SETTINGS } from './chroma'
import { deleteProject, listProjects, putProject, uid } from './db'
import { autoKey, initEditor } from './editor'
import { extractFrames, MAX_FRAMES, type ExtractedFrame } from './extract'
import { ensureFrames, openProjectState, saveProject, state } from './state'
import { toast } from './toast'
import { newProject, type AnimationData, type ProjectData } from './types'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T

type Screen = 'home' | 'project' | 'editor' | 'align' | 'sprites' | 'normalize' | 'genvideo'
let cleanup: (() => void) | null = null

function show(screen: Screen): void {
  cleanup?.()
  cleanup = null
  for (const s of ['home', 'project', 'editor', 'align', 'sprites', 'normalize', 'genvideo'] as const) {
    $(`#screen-${s}`).classList.toggle('hidden', s !== screen)
  }
  document.body.classList.toggle('in-editor', screen !== 'home' && screen !== 'project')
}

function crumb(text: string): void {
  $('#crumb').textContent = text
}

function setNav(label: string | null, fn?: () => void): void {
  const b = $<HTMLButtonElement>('#btn-back')
  if (!label) {
    b.classList.add('hidden')
  } else {
    b.classList.remove('hidden')
    b.textContent = label
    b.onclick = fn ?? null
  }
}

function busyShow(label: string): void {
  $('#busy').classList.remove('hidden')
  $('#busy-label').textContent = label
}

function busyHide(): void {
  $('#busy').classList.add('hidden')
}

// ════ HOME ═══════════════════════════════════════════════

async function goHome(): Promise<void> {
  show('home')
  setNav(null)
  crumb('')
  state.project = null
  state.frames.clear()

  const listEl = $('#project-list')
  listEl.innerHTML = ''
  let projects: ProjectData[] = []
  try {
    projects = await listProjects()
  } catch (err) {
    console.error(err)
    toast('FALHA AO LER OS PROJETOS SALVOS', true)
  }
  projects.sort((a, b) => b.updatedAt - a.updatedAt)

  if (!projects.length) {
    const empty = document.createElement('div')
    empty.className = 'proj-empty'
    empty.textContent = 'nenhum projeto ainda — crie o primeiro acima'
    listEl.append(empty)
    return
  }

  for (const p of projects) {
    const card = document.createElement('div')
    card.className = 'proj-card'
    const name = document.createElement('span')
    name.className = 'pc-name'
    name.textContent = p.name
    const meta = document.createElement('span')
    meta.className = 'pc-meta'
    meta.textContent = `${p.animations.length} animações · ${new Date(p.updatedAt).toLocaleDateString('pt-BR')}`
    const open = document.createElement('button')
    open.className = 'btn btn-small'
    open.textContent = 'ABRIR'
    open.onclick = () => openProject(p)
    const del = document.createElement('button')
    del.className = 'btn btn-small danger'
    del.textContent = 'X'
    del.title = 'excluir projeto'
    del.onclick = async () => {
      if (!confirm(`Excluir o projeto "${p.name}"? Os vídeos salvos nele serão perdidos.`)) return
      await deleteProject(p.id)
      void goHome()
    }
    card.append(name, meta, open, del)
    card.ondblclick = () => openProject(p)
    listEl.append(card)
  }
}

$<HTMLButtonElement>('#btn-create').onclick = async () => {
  const input = $<HTMLInputElement>('#new-proj-name')
  const name = input.value.trim()
  if (!name) {
    toast('DÊ UM NOME AO PROJETO', true)
    input.focus()
    return
  }
  const p = newProject(uid(), name)
  await putProject(p)
  input.value = ''
  openProject(p)
}
$<HTMLInputElement>('#new-proj-name').onkeydown = (e) => {
  if (e.code === 'Enter') $('#btn-create').click()
}

$<HTMLButtonElement>('#btn-normalize').onclick = () => {
  show('normalize')
  crumb('normalizador de referências')
  setNav('← INÍCIO', () => void goHome())
  cleanup = initNormalize()
}

function openProject(p: ProjectData): void {
  openProjectState(p)
  goProject()
}

// ════ PROJETO (dashboard) ════════════════════════════════

function goProject(): void {
  const p = state.project!
  show('project')
  setNav('← PROJETOS', () => {
    void saveProject().then(goHome)
  })
  crumb(p.name)

  const title = $<HTMLInputElement>('#proj-title')
  title.value = p.name
  title.oninput = () => {
    p.name = title.value.trim() || p.name
    crumb(p.name)
  }
  title.onchange = () => void saveProject()

  $<HTMLButtonElement>('#btn-align').onclick = () => {
    if (!p.animations.length) {
      toast('ADICIONE AO MENOS 1 VÍDEO', true)
      return
    }
    goAlign()
  }

  $<HTMLButtonElement>('#btn-genvideo-proj').onclick = goGenVideo
  $<HTMLButtonElement>('#btn-sprites-proj').onclick = goSprites

  hideImportPanel()
  renderRefsRow()
  renderAnimGrid()
}

// ── referências do projeto ────────────────────────────────

function renderRefsRow(): void {
  const p = state.project!
  const row = $('#refs-row')
  row.innerHTML = ''
  $('#refs-count').textContent = p.refs.length ? `· ${p.refs.length}` : ''
  if (!p.refs.length) {
    const hint = document.createElement('span')
    hint.className = 'dim refs-empty'
    hint.textContent =
      'adicione imagens do personagem — ficam salvas no projeto e alimentam o gerador de vídeo'
    row.append(hint)
    return
  }
  for (const ref of p.refs) {
    const cell = document.createElement('div')
    cell.className = 'ref-cell'
    const img = document.createElement('img')
    img.src = URL.createObjectURL(ref.blob)
    img.onload = () => URL.revokeObjectURL(img.src)
    img.title = ref.name
    const del = document.createElement('button')
    del.className = 'ref-del'
    del.textContent = '×'
    del.title = 'remover referência'
    del.onclick = async () => {
      p.refs = p.refs.filter((r) => r.id !== ref.id)
      await saveProject()
      renderRefsRow()
    }
    cell.append(img, del)
    row.append(cell)
  }
}

const refFileInput = $<HTMLInputElement>('#ref-files')
$('#btn-add-ref').onclick = () => refFileInput.click()
refFileInput.onchange = () => {
  if (refFileInput.files?.length) void addRefFiles(Array.from(refFileInput.files))
  refFileInput.value = ''
}
$('#refs-row').ondragover = (e) => e.preventDefault()
$('#refs-row').ondrop = (e) => {
  e.preventDefault()
  if (e.dataTransfer?.files?.length) void addRefFiles(Array.from(e.dataTransfer.files))
}

async function addRefFiles(files: File[]): Promise<void> {
  const p = state.project
  if (!p) return
  let added = 0
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue
    p.refs.push({ id: uid(), name: f.name, blob: f })
    added++
  }
  if (!added) {
    toast('NENHUMA IMAGEM VÁLIDA', true)
    return
  }
  await saveProject()
  renderRefsRow()
}

function renderAnimGrid(): void {
  const p = state.project!
  const grid = $('#anim-grid')
  grid.innerHTML = ''

  const add = document.createElement('button')
  add.className = 'anim-card add-card'
  add.innerHTML = '+ VÍDEO'
  add.onclick = () => $<HTMLInputElement>('#anim-file').click()
  add.ondragover = (e) => { e.preventDefault(); add.classList.add('dragover') }
  add.ondragleave = () => add.classList.remove('dragover')
  add.ondrop = (e) => {
    e.preventDefault()
    add.classList.remove('dragover')
    const f = e.dataTransfer?.files?.[0]
    if (f) void chooseFile(f)
  }
  grid.append(add)

  for (const a of p.animations) {
    const card = document.createElement('div')
    card.className = 'anim-card'

    const thumb = document.createElement('div')
    thumb.className = 'ac-thumb checker'
    if (a.thumb) {
      const img = document.createElement('img')
      img.src = URL.createObjectURL(a.thumb)
      img.onload = () => URL.revokeObjectURL(img.src)
      thumb.append(img)
    }
    const body = document.createElement('div')
    body.className = 'ac-body'
    const name = document.createElement('div')
    name.className = 'ac-name'
    name.textContent = a.name
    const meta = document.createElement('div')
    meta.className = 'ac-meta dim'
    const sel = a.selected.filter(Boolean).length
    meta.textContent = `${sel}/${a.selected.length} frames · ${a.fps} fps` + (a.crossfade ? ` · fade ${a.crossfade}` : '')
    body.append(name, meta)

    const actions = document.createElement('div')
    actions.className = 'ac-actions'
    const edit = document.createElement('button')
    edit.className = 'btn btn-small'
    edit.textContent = 'EDITAR_'
    edit.onclick = () => void goEditor(a)
    const del = document.createElement('button')
    del.className = 'btn btn-small danger'
    del.textContent = 'X'
    del.title = 'remover animação'
    del.onclick = async () => {
      if (!confirm(`Remover a animação "${a.name}"?`)) return
      p.animations = p.animations.filter((x) => x.id !== a.id)
      state.frames.delete(a.id)
      await saveProject()
      renderAnimGrid()
    }
    actions.append(edit, del)

    card.append(thumb, body, actions)
    card.ondblclick = () => void goEditor(a)
    grid.append(card)
  }
}

// ── importação de vídeo ───────────────────────────────────

const fileInput = $<HTMLInputElement>('#anim-file')
const fpsSelect = $<HTMLSelectElement>('#extract-fps')
const resSelect = $<HTMLSelectElement>('#extract-res')
let pendingFile: File | null = null
let pendingDuration = 0
let importBusy = false

fileInput.onchange = () => {
  const f = fileInput.files?.[0]
  if (f) void chooseFile(f)
  fileInput.value = ''
}

async function chooseFile(f: File): Promise<void> {
  if (importBusy) return
  if (!f.type.startsWith('video/') && !/\.(mp4|webm|mov|mkv|avi)$/i.test(f.name)) {
    toast('O ARQUIVO NÃO É UM VÍDEO', true)
    return
  }
  const url = URL.createObjectURL(f)
  const v = document.createElement('video')
  v.preload = 'metadata'
  v.src = url
  try {
    await new Promise<void>((resolve, reject) => {
      v.onloadedmetadata = () => resolve()
      v.onerror = () => reject(new Error('formato não suportado'))
    })
  } catch {
    URL.revokeObjectURL(url)
    toast('NÃO FOI POSSÍVEL LER O VÍDEO', true)
    return
  }

  pendingFile = f
  pendingDuration = v.duration
  $('#fi-name').textContent = f.name
  $('#fi-meta').textContent =
    `${(f.size / 1048576).toFixed(1)} MB · ${v.videoWidth}×${v.videoHeight} · ${pendingDuration.toFixed(1)}s`
  URL.revokeObjectURL(url)
  $('#import-panel').classList.remove('hidden')
  $('#extract-progress').classList.add('hidden')
  $<HTMLButtonElement>('#btn-extract').disabled = false
  updateEstimate()
}

function updateEstimate(): void {
  if (!pendingFile) return
  const fps = Number(fpsSelect.value)
  const wanted = Math.max(1, Math.floor(pendingDuration * fps))
  const total = Math.min(wanted, MAX_FRAMES)
  $('#extract-estimate').textContent =
    `≈ ${total} FRAMES` + (wanted > MAX_FRAMES ? ` (LIMITE ${MAX_FRAMES})` : '')
}

fpsSelect.onchange = updateEstimate

function hideImportPanel(): void {
  $('#import-panel').classList.add('hidden')
  pendingFile = null
}

$<HTMLButtonElement>('#btn-import-cancel').onclick = hideImportPanel

$<HTMLButtonElement>('#btn-extract').onclick = async () => {
  const p = state.project
  if (!pendingFile || importBusy || !p) return
  importBusy = true
  const btn = $<HTMLButtonElement>('#btn-extract')
  btn.disabled = true
  $('#extract-progress').classList.remove('hidden')

  const fps = Number(fpsSelect.value)
  const maxDim = Number(resSelect.value)

  try {
    const result = await extractFrames(pendingFile, fps, maxDim, (done, total) => {
      $('#progress-bar').style.width = `${(done / total) * 100}%`
      $('#progress-label').textContent =
        `EXTRAINDO ${String(done).padStart(3, '0')}/${String(total).padStart(3, '0')}`
    })
    if (result.truncated) toast(`LIMITE DE ${MAX_FRAMES} FRAMES ATINGIDO`)

    const anim: AnimationData = {
      id: uid(),
      name: pendingFile.name.replace(/\.[^.]+$/, '').replace(/[^\w\s-]+/g, '').trim() || 'animacao',
      video: pendingFile,
      videoName: pendingFile.name,
      extractFps: fps,
      maxDim,
      chroma: { ...DEFAULT_SETTINGS, key: autoKey(result.frames[0].full) },
      selected: result.frames.map(() => true),
      speed: result.frames.map(() => 1),
      curve: [{ t: 0, v: 1 }, { t: 1, v: 1 }],
      crossfade: 0,
      fps,
      align: { dx: 0, dy: 0, scale: 1 },
      thumb: await makeThumbBlob(result.frames),
    }
    state.frames.set(anim.id, result.frames)
    p.animations.push(anim)
    await saveProject()
    hideImportPanel()
    void goEditor(anim)
  } catch (err) {
    console.error(err)
    toast('FALHA NA EXTRAÇÃO — TENTE OUTRO FORMATO', true)
    btn.disabled = false
    $('#extract-progress').classList.add('hidden')
  } finally {
    importBusy = false
  }
}

function makeThumbBlob(frames: ExtractedFrame[]): Promise<Blob | null> {
  return new Promise((resolve) => {
    const t = frames[0]?.thumb
    if (!t) {
      resolve(null)
      return
    }
    const cv = document.createElement('canvas')
    cv.width = t.width
    cv.height = t.height
    cv.getContext('2d')!.drawImage(t, 0, 0)
    cv.toBlob((b) => resolve(b), 'image/png')
  })
}

// ════ EDITOR ═════════════════════════════════════════════

async function goEditor(anim: AnimationData): Promise<void> {
  const p = state.project!
  busyShow('CARREGANDO FRAMES...')
  try {
    const frames = await ensureFrames(anim, (d, t) =>
      busyShow(`EXTRAINDO ${String(d).padStart(3, '0')}/${String(t).padStart(3, '0')}`))
    show('editor')
    crumb(`${p.name} / ${anim.name}`)
    setNav('← VOLTAR', () => {
      void saveProject()
      goProject()
    })
    cleanup = initEditor(anim, frames)
  } catch (err) {
    console.error(err)
    toast('FALHA AO CARREGAR O VÍDEO', true)
  } finally {
    busyHide()
  }
}

// ════ GERADOR DE VÍDEO ═══════════════════════════════════

function goGenVideo(): void {
  const p = state.project!
  show('genvideo')
  crumb(`${p.name} / gerar vídeo`)
  setNav('← VOLTAR', () => {
    void saveProject()
    goProject()
  })
  cleanup = initGenVideo({
    onUse: (file) => {
      goProject()
      void chooseFile(file)
    },
  })
}

// ════ ALINHAMENTO ════════════════════════════════════════

function goAlign(): void {
  const p = state.project!
  show('align')
  crumb(`${p.name} / alinhamento`)
  setNav('← VOLTAR', () => {
    void saveProject()
    goProject()
  })
  $<HTMLButtonElement>('#btn-align-next').onclick = goSprites
  cleanup = initAlign()
}

// ════ SPRITES ════════════════════════════════════════════

function goSprites(): void {
  const p = state.project!
  if (!p.animations.length) {
    toast('ADICIONE AO MENOS 1 VÍDEO', true)
    return
  }
  show('sprites')
  crumb(`${p.name} / sprites`)
  setNav('← VOLTAR', () => {
    void saveProject()
    goProject()
  })
  cleanup = initSprites()
}

// ════ start ══════════════════════════════════════════════

window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

void goHome()
