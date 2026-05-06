import { app } from "../src/index";

export const createMemoryKV = (): KVNamespace => {
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

export const registerUser = async (
  kv: KVNamespace,
  email = "student@example.com",
  password = "correct-horse-battery-staple",
): Promise<{ token: string; user: { id: string; email: string } }> => {
  const res = await app.request(
    "/api/auth/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    { AUTO_WRITER_KV: kv },
  );

  if (res.status !== 201) {
    throw new Error(
      `Failed to register test user: ${res.status} ${await res.text()}`,
    );
  }

  return (await res.json()) as {
    token: string;
    user: { id: string; email: string };
  };
};

export const authHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});
