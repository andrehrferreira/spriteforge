let timer = 0

export function toast(msg: string, error = false): void {
    const el = document.getElementById('toast')!
    el.textContent = msg
    el.classList.toggle('error', error)
    el.classList.remove('hidden')
    clearTimeout(timer)
    timer = window.setTimeout(() => el.classList.add('hidden'), 3200)
}
