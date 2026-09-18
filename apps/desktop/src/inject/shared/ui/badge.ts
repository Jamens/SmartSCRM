import { CSS_PREFIX, VERSION } from '../../constants/config'

/** Injects a lightweight corner badge confirming the SCRM layer is mounted. */
export function mountBadge(platform: string): () => void {
  const styleId = `${CSS_PREFIX}-badge-style`
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      .${CSS_PREFIX}-badge{position:fixed;right:16px;bottom:16px;z-index:2147483000;
        display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:9999px;
        background:linear-gradient(135deg,#0b2a6b,#2a5bd7);color:#fff;font:500 12px/1 system-ui,sans-serif;
        box-shadow:0 8px 24px rgba(10,30,80,.35);user-select:none;transition:opacity .2s}
      .${CSS_PREFIX}-badge__dot{width:8px;height:8px;border-radius:50%;background:#ffd35c;
        box-shadow:0 0 0 3px rgba(255,211,92,.25)}`
    document.head.appendChild(style)
  }

  let el = document.querySelector<HTMLElement>(`.${CSS_PREFIX}-badge`)
  if (!el) {
    el = document.createElement('div')
    el.className = `${CSS_PREFIX}-badge`
    el.innerHTML = `<span class="${CSS_PREFIX}-badge__dot"></span><span></span><span style="opacity:.65">v${VERSION}</span>`
    document.body.appendChild(el)
  }
  const label = el.querySelectorAll('span')[1]
  label.textContent = platform

  return () => {
    el?.remove()
  }
}
