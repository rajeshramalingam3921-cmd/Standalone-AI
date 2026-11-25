/** One file-changing operation or command per project at a time (in-process). */
export class ProjectLocks {
  private held = new Set<string>();

  tryAcquire(projectId: string): boolean {
    if (this.held.has(projectId)) return false;
    this.held.add(projectId);
    return true;
  }

  /** Wait up to `timeoutMs` for the lock. */
  async acquire(projectId: string, timeoutMs = 60_000): Promise<boolean> {
    const until = Date.now() + timeoutMs;
    while (!this.tryAcquire(projectId)) {
      if (Date.now() > until) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
    return true;
  }

  release(projectId: string): void {
    this.held.delete(projectId);
  }

  isHeld(projectId: string): boolean {
    return this.held.has(projectId);
  }
}
