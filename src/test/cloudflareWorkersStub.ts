/**
 * Stands in for `cloudflare:workers`, which only exists inside the Workers
 * runtime, so the Worker's routing can be imported and driven under vitest.
 *
 * Only the base class is needed: the tests that use this exercise the router in
 * `worker/index.ts`, and never reach a Durable Object.
 */
export class DurableObject<Env = unknown> {
  constructor(readonly ctx: unknown, readonly env: Env) {}
}
