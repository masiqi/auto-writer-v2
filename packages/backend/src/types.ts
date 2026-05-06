export type Bindings = {
  AUTO_WRITER_KV: KVNamespace;
  WRITING_QUEUE?: Queue<{
    taskId: string;
    userId: string;
    resumeFromIndex?: number;
    userModifications?: Record<string, string>;
  }> & {
    sendMessage?: (message: {
      taskId: string;
      userId: string;
      resumeFromIndex?: number;
      userModifications?: Record<string, string>;
    }) => Promise<unknown>;
  };
};

export type Variables = {
  userId: string;
  userEmail: string;
};

export type AuthUser = {
  id: string;
  email: string;
};

export type ErrorCode =
  | "BAD_REQUEST"
  | "CONFIGURATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR";

export type ErrorResponse = {
  error: {
    code: ErrorCode;
    message: string;
  };
};
