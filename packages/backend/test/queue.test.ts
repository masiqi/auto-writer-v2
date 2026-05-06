import { afterEach, describe, expect, it, vi } from "vitest";
import { progressKey, queue } from "../src/queue";
import { AGENTS } from "../src/agents/definitions";
import type { WritingTask } from "../src/agents/types";
import type { Bindings } from "../src/types";
import { createMemoryKV } from "./helpers";

const USER_ID = "user-1";
const taskKey = (userId: string, id: string) => `user:${userId}:writing:${id}`;

const createEnv = async (): Promise<Bindings> => {
  const kv = createMemoryKV();
  await kv.put(
    `user:${USER_ID}:config:llm`,
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
    userId: USER_ID,
    topic: "写一篇关于选择的作文。",
    requirements: "年级：高一",
    status: "running",
    agentResults: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  await kv.put(taskKey(task.userId, task.id), JSON.stringify(task));
  return task;
};

type TestWritingPipelineMessage = {
  taskId: string;
  userId: string;
  resumeFromIndex?: number;
  userModifications?: Record<string, string>;
};

const createBatch = (
  messages: TestWritingPipelineMessage[],
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
  }) as unknown as MessageBatch<TestWritingPipelineMessage>;

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

    await queue(createBatch([{ taskId: task.id, userId: task.userId }]), env);

    const stored = JSON.parse(
      (await env.AUTO_WRITER_KV.get(taskKey(task.userId, task.id))) ?? "{}",
    ) as WritingTask;
    expect(stored.status).toBe("completed");
    expect(stored.result).toBe("agent output");
    expect(stored.agentResults).toHaveLength(AGENTS.length);
    expect(fetchMock).toHaveBeenCalledTimes(AGENTS.length);
  });

  it("pauses interactive tasks after the selected materials agent", async () => {
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
    const task = await createTask(env.AUTO_WRITER_KV, { interactive: true });

    await queue(createBatch([{ taskId: task.id, userId: task.userId }]), env);

    const stored = JSON.parse(
      (await env.AUTO_WRITER_KV.get(taskKey(task.userId, task.id))) ?? "{}",
    ) as WritingTask;
    const progress = JSON.parse(
      (await env.AUTO_WRITER_KV.get(progressKey(task.userId, task.id))) ?? "[]",
    );

    expect(stored.status).toBe("paused");
    expect(stored.pausedAtAgent).toBe(2);
    expect(stored.pauseReason).toBe("review_materials");
    expect(stored.agentResults).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(progress.at(-1)).toMatchObject({
      type: "pipeline_paused",
      agentName: "select-materials",
      agentIndex: 2,
      output: "agent output",
    });
  });

  it("resumes interactive tasks from the requested agent index", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: body.messages[1].content } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = await createEnv();
    const existingResults = AGENTS.slice(0, 3).map((agent) => ({
      agentName: agent.name,
      output: `Existing output from ${agent.name}`,
      duration: 1,
    }));
    const task = await createTask(env.AUTO_WRITER_KV, {
      interactive: true,
      status: "paused",
      pausedAtAgent: 2,
      pauseReason: "review_materials",
      agentResults: existingResults,
      userModifications: {
        "select-materials": "请换成航天素材。",
      },
    });

    await queue(
      createBatch([
        {
          taskId: task.id,
          userId: task.userId,
          resumeFromIndex: 3,
          userModifications: task.userModifications,
        },
      ]),
      env,
    );

    const stored = JSON.parse(
      (await env.AUTO_WRITER_KV.get(taskKey(task.userId, task.id))) ?? "{}",
    ) as WritingTask;

    expect(stored.status).toBe("paused");
    expect(stored.pausedAtAgent).toBe(3);
    expect(stored.pauseReason).toBe("review_outline");
    expect(stored.agentResults).toHaveLength(4);
    expect(stored.agentResults[3].output).toContain("请换成航天素材。");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("marks the task as failed when queued pipeline execution fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("server error", { status: 500 })),
    );

    const env = await createEnv();
    const task = await createTask(env.AUTO_WRITER_KV);

    await queue(createBatch([{ taskId: task.id, userId: task.userId }]), env);

    const stored = JSON.parse(
      (await env.AUTO_WRITER_KV.get(taskKey(task.userId, task.id))) ?? "{}",
    ) as WritingTask;
    expect(stored.status).toBe("failed");
    expect(stored.error).toContain("LLM request failed with status 500");
  });

  it("marks the task as failed when LLM config is missing", async () => {
    const kv = createMemoryKV();
    const env = { AUTO_WRITER_KV: kv };
    const task = await createTask(kv);

    await queue(createBatch([{ taskId: task.id, userId: task.userId }]), env);

    const stored = JSON.parse(
      (await kv.get(taskKey(task.userId, task.id))) ?? "{}",
    ) as WritingTask;
    expect(stored.status).toBe("failed");
    expect(stored.error).toBe("LLM config is not configured");
  });
});
