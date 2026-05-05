export type Bindings = {
  AUTO_WRITER_KV: KVNamespace;
};

export type ErrorCode =
  | "BAD_REQUEST"
  | "CONFIGURATION_ERROR"
  | "NOT_FOUND"
  | "VALIDATION_ERROR";

export type ErrorResponse = {
  error: {
    code: ErrorCode;
    message: string;
  };
};
