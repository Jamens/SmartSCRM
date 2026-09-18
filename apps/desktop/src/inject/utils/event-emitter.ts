/** Minimal typed event emitter used by the inject framework. */
export class EventEmitter<Events extends Record<string, unknown> = Record<string, any>> {
  private listeners = new Map<keyof Events, Set<(payload: any) => void>>()

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(handler as (payload: any) => void)
    return () => this.off(event, handler)
  }

  off<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): void {
    this.listeners.get(event)?.delete(handler as (payload: any) => void)
  }

  emit<K extends keyof Events>(event: K, payload?: Events[K]): void {
    this.listeners.get(event)?.forEach((h) => {
      try {
        h(payload)
      } catch (e) {
        console.error('[inject] listener error', event, e)
      }
    })
  }

  removeAllEvents(): void {
    this.listeners.clear()
  }
}
