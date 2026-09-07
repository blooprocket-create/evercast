export type EventListener<T> = (event: T) => void;

export class EventBus<T> {
  private readonly listeners = new Set<EventListener<T>>();
  private queue: T[] = [];
  private dispatching = false;

  constructor(private readonly maxEventsPerFlush = 10_000) {}

  subscribe(listener: EventListener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: T): void {
    this.queue.push(event);
    if (!this.dispatching) this.flush();
  }

  private flush(): void {
    this.dispatching = true;
    let processed = 0;
    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift();
        if (event === undefined) continue;
        processed += 1;
        if (processed > this.maxEventsPerFlush) {
          this.queue = [];
          throw new Error(`Event bus safety limit exceeded (${this.maxEventsPerFlush}).`);
        }
        for (const listener of [...this.listeners]) listener(event);
      }
    } finally {
      this.dispatching = false;
    }
  }
}
