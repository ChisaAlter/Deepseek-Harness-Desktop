/**
 * Built-in node:http webhook server adapter.
 *
 * A minimal HTTP server that receives QQ webhook callbacks. If you prefer
 * Express/Fastify/Koa, implement `WebhookServerAdapter` and pass it as
 * `webhook.server` in QQBotOptions.
 */

import * as http from "node:http";
import type { WebhookRequestHandler, WebhookServerAdapter } from "./types.js";

export class NodeHttpWebhookServer implements WebhookServerAdapter {
  private server: http.Server | null = null;

  async listen(port: number, path: string, handler: WebhookRequestHandler): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        // Only accept POST to the configured path
        if (req.method !== "POST" || req.url !== path) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
          return;
        }

        // Collect body
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          try {
            const body = Buffer.concat(chunks);
            const headers: Record<string, string | string[] | undefined> = {};
            for (const [key, value] of Object.entries(req.headers)) {
              headers[key.toLowerCase()] = value;
            }

            const response = await handler({ body, headers });

            res.writeHead(response.status, {
              "Content-Type": "application/json",
              ...(response.headers ?? {}),
            });
            res.end(response.body);
          } catch (_err) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Internal Server Error");
          }
        });
      });

      server.on("error", reject);
      server.listen(port, () => {
        this.server = server;
        resolve();
      });
    });
  }

  close(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
