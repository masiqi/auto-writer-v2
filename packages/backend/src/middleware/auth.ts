import { createMiddleware } from "hono/factory";
import { verifyJwt } from "../auth/crypto";
import type { Bindings, ErrorResponse, Variables } from "../types";

const error = (
  code: ErrorResponse["error"]["code"],
  message: string,
): ErrorResponse => ({
  error: { code, message },
});

export const bearerAuth = () =>
  createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
    async (c, next) => {
      const authorization = c.req.header("Authorization");
      const match = authorization?.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        return c.json(
          error("UNAUTHORIZED", "Missing or invalid bearer token"),
          401,
        );
      }

      const kv = c.env.AUTO_WRITER_KV;
      if (!kv) {
        return c.json(
          error("CONFIGURATION_ERROR", "KV binding is not configured"),
          500,
        );
      }

      const user = await verifyJwt(kv, match[1]);
      if (!user) {
        return c.json(
          error("UNAUTHORIZED", "Missing or invalid bearer token"),
          401,
        );
      }

      c.set("userId", user.id);
      c.set("userEmail", user.email);
      await next();
    },
  );
