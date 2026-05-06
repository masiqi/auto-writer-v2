import { cors } from "hono/cors";
import { Hono } from "hono";
import authRoutes from "./routes/auth";
import configRoutes from "./routes/config";
import topicsRoutes from "./routes/topics";
import writingRoutes from "./routes/writing";
import { bearerAuth } from "./middleware/auth";
import { queue } from "./queue";
import type { Bindings, ErrorResponse, Variables } from "./types";

export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", cors());

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

app.route("/api/auth", authRoutes);
app.use("/api/writing/*", bearerAuth());
app.use("/api/config/*", bearerAuth());
app.use("/api/topics/*", bearerAuth());
app.route("/api/writing", writingRoutes);
app.route("/api/config", configRoutes);
app.route("/api/topics", topicsRoutes);

app.notFound((c) => c.json(error("NOT_FOUND", "Not found"), 404));

export const fetch = app.fetch;

export { queue };

export default {
  fetch,
  queue,
} satisfies ExportedHandler<Bindings>;
