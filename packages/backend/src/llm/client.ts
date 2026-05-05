import type { LLMCallConfig } from "./types";

type LLMClientOptions = {
  baseUrl: string;
  apiKey: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
};

const maxAttempts = 3;
const initialBackoffMs = 100;

export class LLMClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: LLMClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
  }

  async chat(
    systemPrompt: string,
    userMessage: string,
    config: LLMCallConfig = {},
  ): Promise<string> {
    return this.withRetry(async () => {
      const response = await this.request(systemPrompt, userMessage, config, false);
      const data = (await response.json()) as ChatCompletionResponse;

      return data.choices?.[0]?.message?.content ?? "";
    });
  }

  async chatStream(
    systemPrompt: string,
    userMessage: string,
    config: LLMCallConfig = {},
    onChunk: (chunk: string) => void,
  ): Promise<string> {
    return this.withRetry(async () => {
      const response = await this.request(systemPrompt, userMessage, config, true);

      if (!response.body) {
        throw new Error("LLM streaming response did not include a body");
      }

      return this.readSSEStream(response.body, onChunk);
    });
  }

  private async request(
    systemPrompt: string,
    userMessage: string,
    config: LLMCallConfig,
    stream: boolean,
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(this.createRequestBody(systemPrompt, userMessage, config, stream)),
    });

    if (!response.ok) {
      throw await LLMRequestError.fromResponse(response);
    }

    return response;
  }

  private createRequestBody(
    systemPrompt: string,
    userMessage: string,
    config: LLMCallConfig,
    stream: boolean,
  ) {
    return {
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    };
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts || !this.isTransientError(error)) {
          throw error;
        }

        await this.delay(initialBackoffMs * 2 ** (attempt - 1));
      }
    }

    throw lastError;
  }

  private isTransientError(error: unknown): boolean {
    if (error instanceof LLMRequestError) {
      return error.status === 429 || error.status >= 500;
    }

    return error instanceof TypeError;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private async readSSEStream(
    body: ReadableStream<Uint8Array>,
    onChunk: (chunk: string) => void,
  ): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const chunk = this.parseSSEEvent(event);
        if (chunk === null) {
          continue;
        }

        fullText += chunk;
        onChunk(chunk);
      }
    }

    buffer += decoder.decode();
    const trailingChunk = this.parseSSEEvent(buffer);
    if (trailingChunk !== null) {
      fullText += trailingChunk;
      onChunk(trailingChunk);
    }

    return fullText;
  }

  private parseSSEEvent(event: string): string | null {
    const data = event
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .join("");

    if (!data || data === "[DONE]") {
      return null;
    }

    const chunk = JSON.parse(data) as ChatCompletionChunk;

    return chunk.choices?.[0]?.delta?.content ?? null;
  }
}

class LLMRequestError extends Error {
  private constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }

  static async fromResponse(response: Response): Promise<LLMRequestError> {
    let detail = "";

    try {
      detail = await response.text();
    } catch {
      detail = "";
    }

    const message = detail
      ? `LLM request failed with status ${response.status}: ${detail}`
      : `LLM request failed with status ${response.status}`;

    return new LLMRequestError(response.status, message);
  }
}
