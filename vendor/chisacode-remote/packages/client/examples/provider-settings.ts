import { createChisaCodeClient, type ChisaCodeClient } from "@chisacode/client";

export function createClient(url: string): ChisaCodeClient {
  return createChisaCodeClient({
    url,
  });
}

export async function setSupportedProviderSettings(url: string): Promise<void> {
  const client = createClient(url);

  try {
    await client.connect();

    await client.config.patch({
      providers: {
        codex: {
          enabled: true,
          additionalModels: [
            {
              id: "gpt-5.2",
              label: "GPT-5.2",
              isDefault: true,
            },
          ],
        },
      },
    });
  } finally {
    await client.close();
  }
}

export async function addCustomCodexProfile(url: string): Promise<void> {
  const client = createClient(url);

  try {
    await client.connect();

    await client.config.patch({
      providers: {
        "codex-proxy": {
          extends: "codex",
          label: "Codex Proxy",
          env: {
            OPENAI_API_KEY: "sk-...",
            OPENAI_BASE_URL: "https://example.test/v1",
          },
          models: [
            {
              id: "custom-model",
              label: "Custom Model",
              isDefault: true,
            },
          ],
        },
      },
    });
  } finally {
    await client.close();
  }
}
