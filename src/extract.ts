/**
 * Extração de frames: percorre o vídeo por seek em intervalos regulares
 * e captura cada frame como ImageBitmap (versão completa + miniatura).
 */

export interface ExtractedFrame {
  full: ImageBitmap
  thumb: ImageBitmap
  time: number
}

export interface ExtractResult {
  frames: ExtractedFrame[]
  width: number
  height: number
  truncated: boolean
}

export const MAX_FRAMES = 600
const THUMB_WIDTH = 148

export async function extractFrames(
  src: Blob,
  fps: number,
  maxDim: number, // 0 = resolução original
  onProgress: (done: number, total: number) => void,
): Promise<ExtractResult> {
  const url = URL.createObjectURL(src)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'

  try {
    await waitEvent(video, 'loadedmetadata')
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitEvent(video, 'canplay')
    }

    const duration = video.duration
    const wanted = Math.max(1, Math.floor(duration * fps))
    const total = Math.min(wanted, MAX_FRAMES)
    const truncated = wanted > MAX_FRAMES

    const scale = maxDim > 0 ? Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight)) : 1
    const w = Math.max(1, Math.round(video.videoWidth * scale))
    const h = Math.max(1, Math.round(video.videoHeight * scale))
    const tw = Math.min(THUMB_WIDTH, w)
    const th = Math.max(1, Math.round(h * (tw / w)))

    const frames: ExtractedFrame[] = []
    for (let i = 0; i < total; i++) {
      const t = Math.min(i / fps, Math.max(0, duration - 0.001))
      await seekTo(video, t)
      const full = await createImageBitmap(video, {
        resizeWidth: w,
        resizeHeight: h,
        resizeQuality: 'high',
      })
      const thumb = await createImageBitmap(full, { resizeWidth: tw, resizeHeight: th })
      frames.push({ full, thumb, time: t })
      onProgress(i + 1, total)
    }
    return { frames, width: w, height: h, truncated }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function waitEvent(el: HTMLElement, ev: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve() }
    const err = () => { cleanup(); reject(new Error('Falha ao carregar o vídeo')) }
    const cleanup = () => {
      el.removeEventListener(ev, ok)
      el.removeEventListener('error', err)
    }
    el.addEventListener(ev, ok, { once: true })
    el.addEventListener('error', err, { once: true })
  })
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 1e-5 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve()
      return
    }
    let done = false
    let timer = 0
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      video.removeEventListener('seeked', finish)
      resolve()
    }
    video.addEventListener('seeked', finish)
    // alguns vídeos não disparam 'seeked' de forma confiável — tenta de novo
    // com um pequeno deslocamento e, na segunda falha, segue em frente
    const arm = (retry: boolean) => {
      timer = window.setTimeout(() => {
        if (done) return
        if (retry) {
          video.currentTime = Math.min(t + 0.01, Math.max(0, video.duration - 0.001))
          arm(false)
        } else {
          finish()
        }
      }, 1500)
    }
    video.currentTime = t
    arm(true)
  })
}
