import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/index";
import { AGENTS } from "../../src/agents/definitions";
import {
  progressKey,
  taskIndexKey,
  taskKey,
  taskOwnerKey,
} from "../../src/queue";
import type { ProgressEvent, WritingTask } from "../../src/agents/types";
import { authHeaders, createMemoryKV, registerUser } from "../helpers";

type WritingTaskResponse = {
  task: WritingTask;
};

type WritingTaskSummary = Pick<
  WritingTask,
  "id" | "topic" | "requirements" | "status" | "createdAt" | "updatedAt"
> & {
  result?: string;
  error?: string;
};

type WritingTaskListResponse = {
  tasks: WritingTaskSummary[];
};

const env = async (email = "student@example.com") => {
  const kv = createMemoryKV();
  const auth = await registerUser(kv, email);
  await kv.put(
    `user:${auth.user.id}:config:llm`,
    JSON.stringify({
      baseUrl: "https://llm.example.com",
      apiKey: "test-key",
      model: "test-model",
      updatedAt: new Date().toISOString(),
    }),
  );

  return {
    AUTO_WRITER_KV: kv,
    token: auth.token,
    user: auth.user,
  };
};

const waitUntilContext = () => {
  const promises: Promise<unknown>[] = [];

  return {
    ctx: {
      waitUntil: (promise: Promise<unknown>) => {
        promises.push(promise);
      },
    } as unknown as ExecutionContext,
    waitForBackground: async () => {
      await Promise.all(promises);
    },
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Writing routes", () => {
  it("creates a writing task in KV", async () => {
    const bindings = await env();
    const request = {
      title: "材料作文",
      prompt: "请围绕成长写一篇作文。",
      grade: "高一",
    };

    const res = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(bindings.token),
        },
        body: JSON.stringify(request),
      },
      bindings,
    );

    expect(res.status).toBe(201);
    const data = (await res.json()) as WritingTaskResponse;
    expect(data).toMatchObject({
      task: {
        topic: request.prompt,
        requirements: "标题：材料作文\n年级：高一",
        status: "running",
        userId: bindings.user.id,
        agentResults: [],
      },
    });
    expect(data.task.id).toEqual(expect.any(String));
    expect(data.task.createdAt).toEqual(expect.any(String));
    expect(data.task.updatedAt).toEqual(expect.any(String));

    const storedIndex = JSON.parse(
      (await bindings.AUTO_WRITER_KV.get(taskIndexKey(bindings.user.id))) ??
        "[]",
    ) as WritingTaskSummary[];
    expect(storedIndex).toEqual([
      {
        id: data.task.id,
        topic: request.prompt,
        requirements: "标题：材料作文\n年级：高一",
        status: "running",
        createdAt: data.task.createdAt,
        updatedAt: data.task.updatedAt,
      },
    ]);
  });

  it("lists the authenticated user's writing tasks newest first", async () => {
    const bindings = await env();
    const otherUser = await registerUser(
      bindings.AUTO_WRITER_KV,
      "other@example.com",
    );
    const older: WritingTask = {
      id: "older-task",
      userId: bindings.user.id,
      topic: "旧任务",
      status: "completed",
      result: "旧作文",
      agentResults: [],
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-01T10:01:00.000Z",
    };
    const newer: WritingTask = {
      id: "newer-task",
      userId: bindings.user.id,
      topic: "新任务",
      requirements: "年级：高三",
      status: "failed",
      error: "LLM failed",
      agentResults: [],
      createdAt: "2026-05-02T10:00:00.000Z",
      updatedAt: "2026-05-02T10:01:00.000Z",
    };
    const otherTask: WritingTask = {
      id: "other-task",
      userId: otherUser.user.id,
      topic: "别人的任务",
      status: "completed",
      agentResults: [],
      createdAt: "2026-05-03T10:00:00.000Z",
      updatedAt: "2026-05-03T10:01:00.000Z",
    };

    for (const task of [older, newer, otherTask]) {
      await bindings.AUTO_WRITER_KV.put(taskOwnerKey(task.id), task.userId);
      await bindings.AUTO_WRITER_KV.put(
        taskKey(task.userId, task.id),
        JSON.stringify(task),
      );
    }
    await bindings.AUTO_WRITER_KV.put(
      taskIndexKey(bindings.user.id),
      JSON.stringify([older, newer]),
    );
    await bindings.AUTO_WRITER_KV.put(
      taskIndexKey(otherUser.user.id),
      JSON.stringify([otherTask]),
    );

    const res = await app.request(
      "/api/writing",
      { headers: authHeaders(bindings.token) },
      bindings,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as WritingTaskListResponse;
    expect(data.tasks).toEqual([
      {
        id: newer.id,
        topic: newer.topic,
        requirements: newer.requirements,
        status: newer.status,
        error: newer.error,
        createdAt: newer.createdAt,
        updatedAt: newer.updatedAt,
      },
      {
        id: older.id,
        topic: older.topic,
        status: older.status,
        result: older.result,
        createdAt: older.createdAt,
        updatedAt: older.updatedAt,
      },
    ]);
  });

  it("runs the writing pipeline in the background and stores the completed result", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "agent output" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const bindings = await env();
    const { ctx, waitForBackground } = waitUntilContext();
    const createRes = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(bindings.token),
        },
        body: JSON.stringify({ prompt: "写一篇关于选择的作文。" }),
      },
      bindings,
      ctx,
    );
    const created = (await createRes.json()) as WritingTaskResponse;

    expect(created.task.status).toBe("running");
    await waitForBackground();

    const res = await app.request(
      `/api/writing/${created.task.id}`,
      { headers: authHeaders(bindings.token) },
      bindings,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as WritingTaskResponse;
    expect(data.task.status).toBe("completed");
    expect(data.task.agentResults).toHaveLength(AGENTS.length);
    expect(data.task.result).toBe("agent output");
    expect(fetchMock).toHaveBeenCalledTimes(AGENTS.length);
    const storedIndex = JSON.parse(
      (await bindings.AUTO_WRITER_KV.get(taskIndexKey(bindings.user.id))) ??
        "[]",
    ) as WritingTaskSummary[];
    expect(storedIndex[0]).toMatchObject({
      id: created.task.id,
      status: "completed",
      result: "agent output",
    });

    const firstRequest = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://llm.example.com/v1/chat/completions",
    );
    expect(firstRequest.model).toBe("test-model");
    expect(firstRequest.messages[0].role).toBe("system");
    expect(firstRequest.messages[1]).toMatchObject({
      role: "user",
      content: expect.stringContaining("写一篇关于选择的作文。"),
    });
  });

  it("enqueues the writing pipeline when a queue binding is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const sentMessages: Array<{ taskId: string; userId: string }> = [];
    const bindings = {
      ...(await env()),
      WRITING_QUEUE: {
        sendMessage: (message: { taskId: string; userId: string }) => {
          sentMessages.push(message);
          return Promise.resolve();
        },
      },
    };
    const { ctx, waitForBackground } = waitUntilContext();

    const createRes = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(bindings.token),
        },
        body: JSON.stringify({ prompt: "写一篇关于责任的作文。" }),
      },
      bindings,
      ctx,
    );
    const created = (await createRes.json()) as WritingTaskResponse;
    await waitForBackground();

    expect(createRes.status).toBe(201);
    expect(sentMessages).toEqual([
      { taskId: created.task.id, userId: bindings.user.id },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores essay text in task result after all agents complete", async () => {
    const finalEssay = [
      "选择不是一时的冲动，而是在权衡之后仍愿意承担的方向。",
      "",
      "面对岔路时，青年应以清醒辨明价值，以行动回应时代。",
      "",
      "愿我们在每一次选择中校准自我，也照亮前行的道路。",
      "",
      "质量评分：92/100",
    ].join("\n");
    const reviewCommentary = [
      "- 最终评分：92/100",
      "- 等级：优秀",
      "- 最终评语：文章立意明确，结构完整。",
      "- 是否通过：是",
    ].join("\n");

    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const systemPrompt = body.messages[0].content;
        const content = systemPrompt.includes("输出完整的最终作文")
          ? finalEssay
          : reviewCommentary;

        return new Response(
          JSON.stringify({
            choices: [{ message: { content } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const bindings = await env();
    const { ctx, waitForBackground } = waitUntilContext();
    const createRes = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(bindings.token),
        },
        body: JSON.stringify({ prompt: "写一篇关于选择的作文。" }),
      },
      bindings,
      ctx,
    );
    const created = (await createRes.json()) as WritingTaskResponse;

    await waitForBackground();

    const res = await app.request(
      `/api/writing/${created.task.id}`,
      { headers: authHeaders(bindings.token) },
      bindings,
    );
    const data = (await res.json()) as WritingTaskResponse;

    expect(data.task.status).toBe("completed");
    expect(data.task.agentResults).toHaveLength(AGENTS.length);
    expect(data.task.result).toBe(finalEssay);
    expect(data.task.result).toContain("选择不是一时的冲动");
    expect(data.task.result).not.toContain("最终评语");
    expect(data.task.result).not.toContain("是否通过");
  });

  it("marks the writing task as failed when the background pipeline fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("server error", { status: 500 })),
    );

    const bindings = await env();
    const { ctx, waitForBackground } = waitUntilContext();
    const createRes = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(bindings.token),
        },
        body: JSON.stringify({ prompt: "写一篇关于挫折的作文。" }),
      },
      bindings,
      ctx,
    );
    const created = (await createRes.json()) as WritingTaskResponse;

    await waitForBackground();

    const res = await app.request(
      `/api/writing/${created.task.id}`,
      { headers: authHeaders(bindings.token) },
      bindings,
    );
    const data = (await res.json()) as WritingTaskResponse;

    expect(data.task.status).toBe("failed");
    expect(data.task.error).toContain("LLM request failed with status 500");

    const storedIndex = JSON.parse(
      (await bindings.AUTO_WRITER_KV.get(taskIndexKey(bindings.user.id))) ??
        "[]",
    ) as WritingTaskSummary[];
    expect(storedIndex[0]).toMatchObject({
      id: created.task.id,
      status: "failed",
      error: expect.stringContaining("LLM request failed with status 500"),
    });
  });

  it("deletes a writing task, progress, owner key, and task index entry", async () => {
    const bindings = await env();
    const now = new Date().toISOString();
    const task: WritingTask = {
      id: "delete-task",
      userId: bindings.user.id,
      topic: "写一篇关于取舍的作文。",
      status: "completed",
      result: "最终作文",
      agentResults: [],
      createdAt: now,
      updatedAt: now,
    };
    await bindings.AUTO_WRITER_KV.put(taskOwnerKey(task.id), task.userId);
    await bindings.AUTO_WRITER_KV.put(
      taskKey(task.userId, task.id),
      JSON.stringify(task),
    );
    await bindings.AUTO_WRITER_KV.put(
      progressKey(task.userId, task.id),
      JSON.stringify([{ type: "pipeline_complete", timestamp: now }]),
    );
    await bindings.AUTO_WRITER_KV.put(
      taskIndexKey(task.userId),
      JSON.stringify([task]),
    );

    const res = await app.request(
      `/api/writing/${task.id}`,
      { method: "DELETE", headers: authHeaders(bindings.token) },
      bindings,
    );

    expect(res.status).toBe(204);
    await expect(
      bindings.AUTO_WRITER_KV.get(taskKey(task.userId, task.id)),
    ).resolves.toBeNull();
    await expect(
      bindings.AUTO_WRITER_KV.get(progressKey(task.userId, task.id)),
    ).resolves.toBeNull();
    await expect(
      bindings.AUTO_WRITER_KV.get(taskOwnerKey(task.id)),
    ).resolves.toBeNull();
    await expect(
      bindings.AUTO_WRITER_KV.get(taskIndexKey(task.userId)),
    ).resolves.toBe("[]");
  });

  it("returns forbidden when a user deletes another user's writing task", async () => {
    const userA = await env("owner@example.com");
    const userB = await registerUser(
      userA.AUTO_WRITER_KV,
      "reader@example.com",
    );
    const now = new Date().toISOString();
    const task: WritingTask = {
      id: "private-delete-task",
      userId: userA.user.id,
      topic: "写一篇关于边界的作文。",
      status: "completed",
      result: "private essay",
      agentResults: [],
      createdAt: now,
      updatedAt: now,
    };
    await userA.AUTO_WRITER_KV.put(taskOwnerKey(task.id), task.userId);
    await userA.AUTO_WRITER_KV.put(
      taskKey(task.userId, task.id),
      JSON.stringify(task),
    );
    await userA.AUTO_WRITER_KV.put(
      taskIndexKey(task.userId),
      JSON.stringify([task]),
    );

    const res = await app.request(
      `/api/writing/${task.id}`,
      { method: "DELETE", headers: authHeaders(userB.token) },
      userA,
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Writing task belongs to another user",
      },
    });
    await expect(
      userA.AUTO_WRITER_KV.get(taskKey(task.userId, task.id)),
    ).resolves.not.toBeNull();
  });

  it("returns a not found error for missing writing tasks", async () => {
    const bindings = await env();
    const res = await app.request(
      "/api/writing/missing-id",
      { headers: authHeaders(bindings.token) },
      bindings,
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Writing task not found",
      },
    });
  });

  it("returns forbidden when a user reads another user's writing task", async () => {
    const userA = await env("a@example.com");
    const userB = await registerUser(userA.AUTO_WRITER_KV, "b@example.com");
    const now = new Date().toISOString();
    const task: WritingTask = {
      id: "private-task",
      userId: userA.user.id,
      topic: "写一篇关于边界的作文。",
      status: "completed",
      result: "private essay",
      agentResults: [],
      createdAt: now,
      updatedAt: now,
    };
    await userA.AUTO_WRITER_KV.put(taskOwnerKey(task.id), task.userId);
    await userA.AUTO_WRITER_KV.put(
      taskKey(task.userId, task.id),
      JSON.stringify(task),
    );

    const res = await app.request(
      `/api/writing/${task.id}`,
      { headers: authHeaders(userB.token) },
      userA,
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Writing task belongs to another user",
      },
    });
  });

  it("rejects create requests without prompt", async () => {
    const bindings = await env();
    const res = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(bindings.token),
        },
        body: JSON.stringify({ title: "缺少 prompt" }),
      },
      bindings,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "prompt is required",
      },
    });
  });

  it("rejects create requests when LLM config is missing", async () => {
    const kv = createMemoryKV();
    const { token } = await registerUser(kv);
    const res = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ prompt: "写一篇作文。" }),
      },
      { AUTO_WRITER_KV: kv },
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "CONFIGURATION_ERROR",
        message: "LLM config is not configured",
      },
    });
  });

  it("streams writing task status as SSE", async () => {
    const bindings = await env();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "agent output" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    const { ctx, waitForBackground } = waitUntilContext();
    const createRes = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(bindings.token),
        },
        body: JSON.stringify({ prompt: "写一篇关于坚持的作文。" }),
      },
      bindings,
      ctx,
    );
    const created = (await createRes.json()) as WritingTaskResponse;
    await waitForBackground();

    const res = await app.request(
      `/api/writing/${created.task.id}/stream`,
      { headers: authHeaders(bindings.token) },
      bindings,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("event: task");
    expect(body).toContain(`"id":"${created.task.id}"`);
    expect(body).toContain('"status":"completed"');
    expect(body).toContain("event: progress");
    expect(body).toContain('"type":"agent_start"');
    expect(body).toContain('"type":"pipeline_complete"');
  });

  it("keeps the SSE stream open and sends progress added after polling", async () => {
    vi.useFakeTimers();

    const bindings = await env();
    const now = new Date().toISOString();
    const task: WritingTask = {
      id: "streaming-task",
      userId: bindings.user.id,
      topic: "写一篇关于坚持的作文。",
      status: "running",
      agentResults: [],
      createdAt: now,
      updatedAt: now,
    };
    const initialEvent: ProgressEvent = {
      type: "agent_start",
      agentName: "analyze-topic",
      agentIndex: 0,
      totalAgents: 11,
      timestamp: now,
    };
    const nextEvent: ProgressEvent = {
      type: "agent_complete",
      agentName: "analyze-topic",
      agentIndex: 0,
      totalAgents: 11,
      output: "审题完成",
      timestamp: new Date(Date.now() + 1).toISOString(),
    };

    await bindings.AUTO_WRITER_KV.put(
      taskKey(task.userId, task.id),
      JSON.stringify(task),
    );
    await bindings.AUTO_WRITER_KV.put(
      progressKey(task.userId, task.id),
      JSON.stringify([initialEvent]),
    );

    const res = await app.request(
      `/api/writing/${task.id}/stream`,
      { headers: authHeaders(bindings.token) },
      bindings,
    );
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE response body");
    }
    const decoder = new TextDecoder();

    const initialChunks: string[] = [];
    while (!initialChunks.join("").includes('"type":"agent_start"')) {
      const initialChunk = await reader.read();
      expect(initialChunk.done).toBe(false);
      initialChunks.push(decoder.decode(initialChunk.value));
    }
    const initialBody = initialChunks.join("");
    expect(initialBody).toContain("event: task");
    expect(initialBody).toContain(`"id":"${task.id}"`);
    expect(initialBody).toContain('"status":"running"');
    expect(initialBody).toContain("event: progress");
    expect(initialBody).toContain('"type":"agent_start"');

    const nextChunkPromise = reader.read();
    await bindings.AUTO_WRITER_KV.put(
      progressKey(task.userId, task.id),
      JSON.stringify([initialEvent, nextEvent]),
    );
    await vi.advanceTimersByTimeAsync(2_000);

    const nextChunk = await nextChunkPromise;
    expect(nextChunk.done).toBe(false);
    const nextBody = decoder.decode(nextChunk.value);
    expect(nextBody).toBe(
      `event: progress\ndata: ${JSON.stringify(nextEvent)}\n\n`,
    );

    const finalTask: WritingTask = {
      ...task,
      status: "completed",
      result: "最终作文",
      updatedAt: new Date(Date.now() + 2).toISOString(),
    };
    const finalChunkPromise = reader.read();
    await bindings.AUTO_WRITER_KV.put(
      taskKey(task.userId, task.id),
      JSON.stringify(finalTask),
    );
    await vi.advanceTimersByTimeAsync(2_000);

    const finalChunk = await finalChunkPromise;
    expect(finalChunk.done).toBe(false);
    const finalBody = decoder.decode(finalChunk.value);
    expect(finalBody).toContain("event: task");
    expect(finalBody).toContain('"status":"completed"');

    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });
});
