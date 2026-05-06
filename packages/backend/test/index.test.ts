import { describe, it, expect } from "vitest";
import { app } from "../src/index";

describe("Backend API", () => {
  it("should return hello message on GET /", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("message", "Hello from Auto Writer V2!");
  });

  it("should return ok status on GET /health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("status", "ok");
  });
});
