type Listener<T> = (payload: T) => void;

/** Tiny typed event emitter (no Node `events` dependency). */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    const set = (this.listeners[event] ??= new Set());
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners[event];
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (e) {
        // listeners must not break the emitter
        console.warn(`listener for ${String(event)} threw`, e);
      }
    }
  }

  clear(): void {
    this.listeners = {};
  }
}
