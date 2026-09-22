import { describe, expect, it, vi } from "vitest";
import { AgentCreateInFlightDedupe } from "./agent-lifecycle-handler.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("AgentCreateInFlightDedupe", () => {
  it("runs a create without a client-minted agent id immediately", async () => {
    const dedupe = new AgentCreateInFlightDedupe();
    const run = vi.fn(async () => "ok");

    await expect(dedupe.run(undefined, run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight create with the same agent id and re-runs after it settles", async () => {
    const dedupe = new AgentCreateInFlightDedupe();
    const first = deferred<string>();
    const run = vi.fn(() => first.promise);

    const firstResult = dedupe.run("agent-1", run);
    // Let the first run register before the retry arrives.
    await Promise.resolve();
    let retryStarted = false;
    const retryResult = dedupe.run("agent-1", () => {
      retryStarted = true;
      return Promise.resolve("retry");
    });

    // While the first attempt is still running the retry must not start its
    // own create body (it would bypass the serial idempotency check).
    await Promise.resolve();
    expect(retryStarted).toBe(false);

    first.resolve("created");
    await expect(firstResult).resolves.toBe("created");
    await expect(retryResult).resolves.toBe("retry");
    expect(retryStarted).toBe(true);
    // First attempt ran once; the retry re-ran after it settled.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs serial retries with the same agent id each time (idempotency check owns them)", async () => {
    const dedupe = new AgentCreateInFlightDedupe();
    const run = vi.fn(async () => "ok");

    await expect(dedupe.run("agent-1", run)).resolves.toBe("ok");
    await expect(dedupe.run("agent-1", run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs distinct agent ids concurrently", async () => {
    const dedupe = new AgentCreateInFlightDedupe();
    const first = deferred<string>();
    const second = deferred<string>();
    const firstResult = dedupe.run("agent-1", () => first.promise);
    const secondResult = dedupe.run("agent-2", () => second.promise);

    await Promise.resolve();
    first.resolve("a");
    second.resolve("b");
    await expect(firstResult).resolves.toBe("a");
    await expect(secondResult).resolves.toBe("b");
  });

  it("propagates an in-flight failure to the retry", async () => {
    const dedupe = new AgentCreateInFlightDedupe();
    const first = deferred<string>();
    const firstResult = dedupe.run("agent-1", () => first.promise);
    await Promise.resolve();
    const retryResult = dedupe.run("agent-1", () => Promise.resolve("retry"));

    first.reject(new Error("create exploded"));
    await expect(firstResult).rejects.toThrow("create exploded");
    // The retry surfaces the same failure instead of starting a second create.
    await expect(retryResult).rejects.toThrow("create exploded");
  });
});
