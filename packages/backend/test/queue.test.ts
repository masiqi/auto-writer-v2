import { afterEach, describe, expect, it, vi } from "vitest";
import { queue } from "../src/queue";
import { AGENTS } from "../src/agents/definitions";
import type { WritingTask } from "../src/agents/types";
import type { Bindings } from "../src/types";

const taskKey = (id: string) => `writing:${id}`;

const createMemoryKV = (): KVNamespace => {
  const store = new Map<string, string>();

  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    put: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  } as unknown as KVNamespace;
};

const createEnv = async (): Promise<Bindings> => {
  const kv = createMemoryKV();
  await kv.put(
    "config:llm",
    JSON.stringify({
      baseUrl: "https://llm.example.com",
      apiKey: "test-key",
      model: "test-model",
    }),
  );

  return {
    AUTO_WRITER_KV: kv,
  };
};

const createTask = async (
  kv: KVNamespace,
  overrides: Partial<WritingTask> = {},
): Promise<WritingTask> => {
  const now = new Date().toISOString();
  const task: WritingTask = {
    id: "task-1",
    topic: "写一篇关于选择的作文。",
    requirements: "年级：高一",
    status: "running",
    agentResults: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  await kv.put(taskKey(task.id), JSON.stringify(task));
  return task;
};

const createBatch = (
  messages: Array<{ taskId: string }>,
): MessageBatch<unknown> =>
  ({
    queue: "writing-pipeline",
    messages: messages.map((body, index) => ({
      id: `message-${index}`,
      timestamp: new Date(),
      body,
      attempts: 1,
      retry: vi.fn(),
      ack: vi.fn(),
    })),
    metadata: {
      metrics: {
        backlogCount: messages.length,
        backlogBytes: 0,
      },
    },
    retryAll: vi.fn(),
    ackAll: vi.fn(),
  }) as unknown as MessageBatch<{ taskId?: string }>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("writing queue handler", () => {
  it("runs the pipeline for queued task messages and stores the completed task", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "agent output" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = await createEnv();
    const task = await createTask(env.AUTO_WRITER_KV);

    await queue(createBatch([{ taskId: task.id }]), env);

    const stored = JSON.parse(
      (await env.AUTO_WRITER_KV.get(taskKey(task.id))) ?? "{}",
    ) as WritingTask;
    expect(stored.status).toBe("completed");
    expect(stored.result).toBe("agent output");
    expect(stored.agentResults).toHaveLength(AGENTS.length);
    expect(fetchMock).toHaveBeenCalledTimes(AGENTS.length);
  });

  it("marks the task as failed when queued pipeline execution fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("server error", { status: 500 })),
    );

    const env = await createEnv();
    const task = await createTask(env.AUTO_WRITER_KV);

    await queue(createBatch([{ taskId: task.id }]), env);

    const stored = JSON.parse(
      (await env.AUTO_WRITER_KV.get(taskKey(task.id))) ?? "{}",
    ) as WritingTask;
    expect(stored.status).toBe("failed");
    expect(stored.error).toContain("LLM request failed with status 500");
  });

  it("marks the task as failed when LLM config is missing", async () => {
    const kv = createMemoryKV();
    const env = { AUTO_WRITER_KV: kv };
    const task = await createTask(kv);

    await queue(createBatch([{ taskId: task.id }]), env);

    const stored = JSON.parse(
      (await kv.get(taskKey(task.id))) ?? "{}",
    ) as WritingTask;
    expect(stored.status).toBe("failed");
    expect(stored.error).toBe("LLM config is not configured");
  });
});
