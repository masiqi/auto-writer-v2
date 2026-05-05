import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LLMClient } from "../../src/llm/client";

const baseUrl = "https://llm.example.com";
const apiKey = "sk-test";

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });

const sseResponse = (events: string[]) => {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(event));
        }
        controller.close();
      },
    }),
    {
      headers: { "Content-Type": "text/event-stream" },
      status: 200,
    },
  );
};

describe("LLMClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends a non-streaming OpenAI-compatible chat completion request", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: "Draft response" } }],
      }),
    );
    const client = new LLMClient({ baseUrl, apiKey });

    const result = await client.chat("System prompt", "User message", {
      model: "writer-model",
      temperature: 0.7,
      maxTokens: 512,
    });

    expect(result).toBe("Draft response");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://llm.example.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "writer-model",
          temperature: 0.7,
          max_tokens: 512,
          stream: false,
          messages: [
            { role: "system", content: "System prompt" },
            { role: "user", content: "User message" },
          ],
        }),
      },
    );
  });

  it("streams OpenAI-compatible SSE chunks and returns the full text", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const client = new LLMClient({ baseUrl, apiKey });
    const onChunk = vi.fn();

    const result = await client.chatStream(
      "System prompt",
      "User message",
      { model: "writer-model" },
      onChunk,
    );

    expect(result).toBe("Hello world");
    expect(onChunk).toHaveBeenNthCalledWith(1, "Hello");
    expect(onChunk).toHaveBeenNthCalledWith(2, " world");
    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      model: "writer-model",
      stream: true,
    });
  });

  it.each([500, 429])(
    "retries transient HTTP %i errors before returning the response",
    async (status) => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ error: "temporary" }, { status }))
        .mockResolvedValueOnce(jsonResponse({ error: "temporary" }, { status }))
        .mockResolvedValueOnce(
          jsonResponse({
            choices: [{ message: { content: "Recovered response" } }],
          }),
        );
      const client = new LLMClient({ baseUrl, apiKey });

      const promise = client.chat("System prompt", "User message", {
        model: "writer-model",
      });
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe("Recovered response");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it("does not retry non-transient HTTP errors", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "unauthorized" }, { status: 401 }),
    );
    const client = new LLMClient({ baseUrl, apiKey });

    await expect(
      client.chat("System prompt", "User message", { model: "writer-model" }),
    ).rejects.toThrow("LLM request failed with status 401");

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
