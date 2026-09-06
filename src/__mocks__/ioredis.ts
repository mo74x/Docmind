/* eslint-disable @typescript-eslint/no-unused-vars */
export default class RedisMock {
  status = 'ready';
  private store = new Map<string, string>();

  constructor(_options?: any) {}

  get(key: string): string | null {
    return this.store.get(key) || null;
  }

  set(key: string, value: string, _ex?: string, _ttl?: number): 'OK' {
    this.store.set(key, value);
    return 'OK';
  }

  ping(): string {
    return 'PONG';
  }

  quit(): 'OK' {
    return 'OK';
  }

  disconnect(): void {}

  on(_event: string, _callback: (...args: any[]) => void): this {
    return this;
  }

  once(_event: string, _callback: (...args: any[]) => void): this {
    return this;
  }
}
