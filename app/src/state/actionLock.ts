export class ActionLock {
  private readonly active = new Set<string>();

  acquire(key: string): boolean {
    if (this.active.has(key)) return false;
    this.active.add(key);
    return true;
  }

  release(key: string): void {
    this.active.delete(key);
  }

  has(key: string): boolean {
    return this.active.has(key);
  }

  snapshot(): Set<string> {
    return new Set(this.active);
  }
}
