import { Hono } from "hono";
import configRoutes from "./routes/config";
import writingRoutes from "./routes/writing";
import type { Bindings, ErrorResponse } from "./types";

const app = new Hono<{ Bindings: Bindings }>();

const error = (
  code: ErrorResponse["error"]["code"],
  message: string,
): ErrorResponse => ({
  error: { code, message },
});

app.get("/", (c) => {
  return c.json({ message: "Hello from Auto Writer V2!" });
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.route("/api/writing", writingRoutes);
app.route("/api/config", configRoutes);

app.notFound((c) => c.json(error("NOT_FOUND", "Not found"), 404));

export default app;
