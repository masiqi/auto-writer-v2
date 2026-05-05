import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../src/index";
import { AGENTS } from "../../src/agents/definitions";
import type { WritingTask } from "../../src/agents/types";

type WritingTaskResponse = {
  task: WritingTask;
};

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

const env = async () => {
  const kv = createMemoryKV();
  await kv.put(
    "config:llm",
    JSON.stringify({
      baseUrl: "https://llm.example.com",
      apiKey: "test-key",
      model: "test-model",
      updatedAt: new Date().toISOString(),
    }),
  );

  return {
    AUTO_WRITER_KV: kv,
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
        headers: { "Content-Type": "application/json" },
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
        agentResults: [],
      },
    });
    expect(data.task.id).toEqual(expect.any(String));
    expect(data.task.createdAt).toEqual(expect.any(String));
    expect(data.task.updatedAt).toEqual(expect.any(String));
  });

  it("runs the writing pipeline in the background and stores the completed result", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "agent output" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const bindings = await env();
    const { ctx, waitForBackground } = waitUntilContext();
    const createRes = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "写一篇关于选择的作文。" }),
      },
      bindings,
      ctx,
    );
    const created = (await createRes.json()) as WritingTaskResponse;

    expect(created.task.status).toBe("running");
    await waitForBackground();

    const res = await app.request(`/api/writing/${created.task.id}`, {}, bindings);

    expect(res.status).toBe(200);
    const data = (await res.json()) as WritingTaskResponse;
    expect(data.task.status).toBe("completed");
    expect(data.task.agentResults).toHaveLength(AGENTS.length);
    expect(data.task.result).toBe("agent output");
    expect(fetchMock).toHaveBeenCalledTimes(AGENTS.length);

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

    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const systemPrompt = body.messages[0].content;
      const content =
        systemPrompt.includes("输出完整的最终作文") ? finalEssay : reviewCommentary;

      return new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const bindings = await env();
    const { ctx, waitForBackground } = waitUntilContext();
    const createRes = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "写一篇关于选择的作文。" }),
      },
      bindings,
      ctx,
    );
    const created = (await createRes.json()) as WritingTaskResponse;

    await waitForBackground();

    const res = await app.request(`/api/writing/${created.task.id}`, {}, bindings);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "写一篇关于挫折的作文。" }),
      },
      bindings,
      ctx,
    );
    const created = (await createRes.json()) as WritingTaskResponse;

    await waitForBackground();

    const res = await app.request(`/api/writing/${created.task.id}`, {}, bindings);
    const data = (await res.json()) as WritingTaskResponse;

    expect(data.task.status).toBe("failed");
    expect(data.task.error).toContain("LLM request failed with status 500");
  });

  it("returns a not found error for missing writing tasks", async () => {
    const res = await app.request("/api/writing/missing-id", {}, await env());

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Writing task not found",
      },
    });
  });

  it("rejects create requests without prompt", async () => {
    const res = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "缺少 prompt" }),
      },
      await env(),
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
    const res = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "写一篇作文。" }),
      },
      { AUTO_WRITER_KV: createMemoryKV() },
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "写一篇关于坚持的作文。" }),
      },
      bindings,
      ctx,
    );
    const created = (await createRes.json()) as WritingTaskResponse;
    await waitForBackground();

    const res = await app.request(
      `/api/writing/${created.task.id}/stream`,
      {},
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
});
