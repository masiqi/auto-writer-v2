import { describe, expect, it } from "vitest";
import app from "../../src/index";

type WritingTaskResponse = {
  task: {
    id: string;
    title?: string;
    prompt: string;
    grade?: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
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

const env = () => ({
  AUTO_WRITER_KV: createMemoryKV(),
});

describe("Writing routes", () => {
  it("creates a writing task in KV", async () => {
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
      env(),
    );

    expect(res.status).toBe(201);
    const data = (await res.json()) as WritingTaskResponse;
    expect(data).toMatchObject({
      task: {
        title: request.title,
        prompt: request.prompt,
        grade: request.grade,
        status: "pending",
      },
    });
    expect(data.task.id).toEqual(expect.any(String));
    expect(data.task.createdAt).toEqual(expect.any(String));
    expect(data.task.updatedAt).toEqual(data.task.createdAt);
  });

  it("returns a stored writing task by id", async () => {
    const bindings = env();
    const createRes = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "写一篇关于选择的作文。" }),
      },
      bindings,
    );
    const created = (await createRes.json()) as WritingTaskResponse;

    const res = await app.request(`/api/writing/${created.task.id}`, {}, bindings);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(created);
  });

  it("returns a not found error for missing writing tasks", async () => {
    const res = await app.request("/api/writing/missing-id", {}, env());

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
      env(),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "prompt is required",
      },
    });
  });

  it("streams writing task status as SSE", async () => {
    const bindings = env();
    const createRes = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "写一篇关于坚持的作文。" }),
      },
      bindings,
    );
    const created = (await createRes.json()) as WritingTaskResponse;

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
    expect(body).toContain('"status":"pending"');
  });
});
