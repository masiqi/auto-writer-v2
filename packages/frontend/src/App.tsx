import {
  createContext,
  FormEvent,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";

type TaskStatus = "pending" | "running" | "paused" | "completed" | "failed";
type AgentStatus = "waiting" | "running" | "done";

interface WritingTask {
  id: string;
  userId: string;
  topic: string;
  requirements?: string;
  status: TaskStatus;
  result?: string;
  error?: string;
  interactive?: boolean;
  pausedAtAgent?: number | null;
  pauseReason?: string;
  userModifications?: Record<string, string>;
  agentResults: AgentResult[];
  createdAt: string;
  updatedAt: string;
}

type WritingTaskSummary = Pick<
  WritingTask,
  "id" | "topic" | "requirements" | "status" | "createdAt" | "updatedAt"
> & {
  result?: string;
  error?: string;
};

interface AgentResult {
  agentName: string;
  output: string;
  duration: number;
}

interface ProgressEvent {
  type:
    | "agent_start"
    | "agent_progress"
    | "agent_complete"
    | "pipeline_paused"
    | "pipeline_complete"
    | "pipeline_error";
  agentName?: string;
  agentIndex?: number;
  totalAgents?: number;
  output?: string;
  error?: string;
  timestamp: string;
}

interface AgentStep {
  id: string;
  name: string;
  status: AgentStatus;
  summary?: string;
}

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const AUTH_TOKEN_KEY = "auto-writer-v2:jwt";
const AUTH_EMAIL_KEY = "auto-writer-v2:email";

const agentLabels: Record<string, string> = {
  "analyze-topic": "审题分析",
  "determine-theme": "确定立意",
  "select-materials": "选择素材",
  outline: "构建大纲",
  "write-intro": "撰写开头",
  "write-body": "撰写正文",
  "write-conclusion": "撰写结尾",
  polish: "润色优化",
  review: "评审文章",
  revise: "修改完善",
  "final-review": "最终审核",
};

const agentOrder = Object.keys(agentLabels);

const createInitialSteps = (): AgentStep[] =>
  agentOrder.map((id) => ({ id, name: agentLabels[id], status: "waiting" }));

const apiPath = (path: string) => `${API_BASE_URL}${path}`;

interface AuthContextValue {
  token: string | null;
  userEmail: string;
  isLoggedIn: boolean;
  login: (token: string, email: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const useAuth = (): AuthContextValue => {
  const auth = useContext(AuthContext);
  if (!auth) {
    throw new Error("AuthContext is missing");
  }
  return auth;
};

const authFetch = (
  token: string | null,
  path: string,
  init: RequestInit = {},
): Promise<Response> => {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(apiPath(path), { ...init, headers });
};

const summarize = (value: string): string => {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 92 ? `${compact.slice(0, 92)}...` : compact;
};

const essayParagraphs = (essay: string): string[] =>
  essay
    .split(/\n{2,}|\r\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

const statusLabels: Record<TaskStatus, string> = {
  pending: "等待中",
  running: "写作中",
  paused: "待确认",
  completed: "已完成",
  failed: "失败",
};

const statusBadgeClasses: Record<TaskStatus, string> = {
  pending: "border-slate-300/20 bg-slate-300/10 text-slate-200",
  running: "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
  paused: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  completed: "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
  failed: "border-red-300/30 bg-red-400/10 text-red-200",
};

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

function App() {
  const [token, setToken] = useState(() =>
    localStorage.getItem(AUTH_TOKEN_KEY),
  );
  const [userEmail, setUserEmail] = useState(
    () => localStorage.getItem(AUTH_EMAIL_KEY) ?? "",
  );

  const auth = useMemo<AuthContextValue>(
    () => ({
      token,
      userEmail,
      isLoggedIn: Boolean(token),
      login: (nextToken, email) => {
        localStorage.setItem(AUTH_TOKEN_KEY, nextToken);
        localStorage.setItem(AUTH_EMAIL_KEY, email);
        setToken(nextToken);
        setUserEmail(email);
      },
      logout: () => {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_EMAIL_KEY);
        setToken(null);
        setUserEmail("");
      },
    }),
    [token, userEmail],
  );

  return (
    <AuthContext.Provider value={auth}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <AuthShell>
                <LoginPage />
              </AuthShell>
            }
          />
          <Route
            path="/register"
            element={
              <AuthShell>
                <RegisterPage />
              </AuthShell>
            }
          />
          <Route path="/" element={<ProtectedShell />}>
            <Route index element={<HomePage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="writing/:id" element={<WritingPage />} />
            <Route path="result/:id" element={<ResultPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}

function ProtectedShell() {
  const auth = useAuth();
  if (!auth.isLoggedIn) {
    return <Navigate to="/login" replace />;
  }
  return <Shell />;
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen overflow-hidden bg-ink-950 text-slate-100">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.14),transparent_28%),linear-gradient(180deg,#09090b_0%,#111827_52%,#09090b_100%)]" />
      <div className="mx-auto grid min-h-screen w-full max-w-7xl place-items-center px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </div>
    </main>
  );
}

function Shell() {
  const auth = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    auth.logout();
    navigate("/login", { replace: true });
  };

  return (
    <main className="min-h-screen overflow-hidden bg-ink-950 text-slate-100">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.14),transparent_28%),linear-gradient(180deg,#09090b_0%,#111827_52%,#09090b_100%)]" />
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-white/10 pb-4">
          <Link to="/" className="group flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl border border-white/12 bg-white/8 text-sm font-semibold text-cyan-200 shadow-soft transition group-hover:border-cyan-300/50">
              文
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-wide text-white">
                Auto Writer V2
              </span>
              <span className="text-xs text-slate-400">
                高中作文多智能体助手
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-48 truncate text-xs text-slate-300 sm:inline">
              {auth.userEmail}
            </span>
            <Link
              to="/history"
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/10 sm:flex"
            >
              History
            </Link>
            <Link
              to="/settings"
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/10 sm:flex"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="size-3.5"
              >
                <path
                  fillRule="evenodd"
                  d="M6.955 1.45A.5.5 0 0 1 7.452 1h1.096a.5.5 0 0 1 .497.45l.186 1.436c.372.14.722.327 1.042.548l1.37-.52a.5.5 0 0 1 .613.229l.548.95a.5.5 0 0 1-.116.626l-1.108.876c.057.388.057.78 0 1.168l1.108.876a.5.5 0 0 1 .116.625l-.548.95a.5.5 0 0 1-.613.23l-1.37-.521c-.32.22-.67.407-1.042.548l-.186 1.436a.5.5 0 0 1-.497.45H7.452a.5.5 0 0 1-.497-.45l-.186-1.436a4.5 4.5 0 0 1-1.042-.548l-1.37.52a.5.5 0 0 1-.613-.229l-.548-.95a.5.5 0 0 1 .116-.626l1.108-.876a4.5 4.5 0 0 1 0-1.168l-1.108-.876a.5.5 0 0 1-.116-.625l.548-.95a.5.5 0 0 1 .613-.23l1.37.521c.32-.22.67-.407 1.042-.548l.186-1.436ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
                  clipRule="evenodd"
                />
              </svg>
              Settings
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/10"
            >
              Logout
            </button>
            <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-slate-300 sm:flex">
              <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.8)]" />
              11 Agents
            </span>
          </div>
        </header>

        <Outlet />
      </div>
    </main>
  );
}

function LoginPage() {
  return <AuthForm mode="login" />;
}

function RegisterPage() {
  return <AuthForm mode="register" />;
}

function AuthForm({ mode }: { mode: "login" | "register" }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isRegister = mode === "register";

  useEffect(() => {
    if (auth.isLoggedIn) {
      navigate("/", { replace: true });
    }
  }, [auth.isLoggedIn, navigate]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(apiPath(`/api/auth/${mode}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });
      if (!response.ok) {
        throw new Error(
          isRegister
            ? "注册失败，请检查邮箱和密码。"
            : "登录失败，请检查邮箱和密码。",
        );
      }
      const data = (await response.json()) as {
        token: string;
        user: { id: string; email: string };
      };
      auth.login(data.token, data.user.email);
      navigate("/", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "请求失败。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="w-full max-w-md rounded-2xl border border-white/12 bg-ink-900/88 p-6 shadow-panel backdrop-blur md:p-8">
      <Link to="/" className="mb-7 flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl border border-white/12 bg-white/8 text-sm font-semibold text-cyan-200 shadow-soft">
          文
        </span>
        <span>
          <span className="block text-sm font-semibold tracking-wide text-white">
            Auto Writer V2
          </span>
          <span className="text-xs text-slate-400">高中作文多智能体助手</span>
        </span>
      </Link>

      <div className="mb-6">
        <p className="text-sm text-slate-400">Account</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">
          {isRegister ? "创建账号" : "登录"}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <label className="block">
          <span className="field-label">Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className="field-input mt-2"
          />
        </label>

        <label className="block">
          <span className="field-label">Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={isRegister ? "new-password" : "current-password"}
            className="field-input mt-2"
          />
        </label>

        {error ? (
          <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-ink-950 shadow-glow transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "提交中..." : isRegister ? "Register" : "Login"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-slate-400">
        {isRegister ? "Already have an account?" : "Need an account?"}{" "}
        <Link
          to={isRegister ? "/login" : "/register"}
          className="font-medium text-cyan-200 hover:text-cyan-100"
        >
          {isRegister ? "Login" : "Register"}
        </Link>
      </p>
    </section>
  );
}

function HistoryPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<WritingTaskSummary[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    const loadTasks = async () => {
      const response = await authFetch(auth.token, "/api/writing");
      if (!response.ok) {
        if (response.status === 401) {
          auth.logout();
          navigate("/login", { replace: true });
          return;
        }
        throw new Error(`获取历史任务失败 (${response.status})`);
      }

      const data = (await response.json()) as { tasks: WritingTaskSummary[] };
      if (isActive) {
        setTasks(data.tasks);
      }
    };

    void loadTasks()
      .catch((caught) => {
        if (isActive) {
          setError(
            caught instanceof Error ? caught.message : "获取历史任务失败。",
          );
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [auth, navigate]);

  return (
    <section className="flex flex-1 flex-col py-8 lg:py-10">
      <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm text-slate-400">Writing history</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">历史任务</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            查看当前账号创建过的作文任务，继续查看进度或打开已生成的终稿。
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-ink-950 shadow-glow transition hover:bg-cyan-200"
        >
          New Task
        </Link>
      </div>

      {error ? (
        <p className="mb-5 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-24 animate-pulse rounded-xl border border-white/10 bg-white/6"
            />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-2xl border border-white/12 bg-ink-900/88 p-7 text-center shadow-panel backdrop-blur">
          <h2 className="text-lg font-semibold text-white">暂无历史任务</h2>
          <p className="mt-2 text-sm text-slate-400">
            创建第一篇作文后，任务会显示在这里。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <HistoryTaskItem key={task.id} task={task} />
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryTaskItem({ task }: { task: WritingTaskSummary }) {
  const target =
    task.status === "running" || task.status === "pending"
      ? `/writing/${task.id}`
      : `/result/${task.id}`;
  const preview = task.error ?? task.result ?? task.requirements ?? task.topic;

  return (
    <Link
      to={target}
      className="group block rounded-xl border border-white/10 bg-white/6 p-4 transition hover:border-cyan-300/30 hover:bg-white/10"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full border px-2.5 py-1 text-xs ${statusBadgeClasses[task.status]}`}
            >
              {statusLabels[task.status]}
            </span>
            <span className="text-xs text-slate-500">
              创建于 {formatDateTime(task.createdAt)}
            </span>
            <span className="text-xs text-slate-500">
              更新于 {formatDateTime(task.updatedAt)}
            </span>
          </div>
          <h2 className="mt-3 line-clamp-2 text-base font-semibold leading-6 text-white transition group-hover:text-cyan-100">
            {task.topic}
          </h2>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">
            {preview}
          </p>
        </div>
        <span className="shrink-0 text-sm text-cyan-200 transition group-hover:translate-x-1">
          查看
        </span>
      </div>
    </Link>
  );
}

function HomePage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [grade, setGrade] = useState("高一");
  const [requirements, setRequirements] = useState("");
  const [interactive, setInteractive] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!prompt.trim()) {
      setError("请先输入作文题目或材料。");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await authFetch(auth.token, "/api/writing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          title: title.trim() || undefined,
          grade,
          requirements: requirements.trim() || undefined,
          interactive,
        }),
      });

      if (!response.ok) {
        throw new Error(`创建写作任务失败 (${response.status})`);
      }

      const data = (await response.json()) as { task: WritingTask };
      navigate(`/writing/${data.task.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建写作任务失败。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[0.95fr_1.05fr] lg:py-16">
      <div className="max-w-xl">
        <p className="mb-4 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-200">
          从审题到终稿，一次完成
        </p>
        <h1 className="text-balance text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
          面向高中作文的 AI 写作工作台
        </h1>
        <p className="mt-5 max-w-lg text-base leading-8 text-slate-300">
          输入题目、年级和写作要求，系统会按审题、立意、选材、大纲、成文、评审和修改的顺序生成一篇完整作文。
        </p>
        <div className="mt-8 grid grid-cols-3 gap-3 text-center">
          {["审题", "成文", "评审"].map((item) => (
            <div
              key={item}
              className="rounded-lg border border-white/10 bg-white/6 px-3 py-4"
            >
              <div className="text-lg font-semibold text-white">{item}</div>
              <div className="mt-1 text-xs text-slate-400">Agent 阶段</div>
            </div>
          ))}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-white/12 bg-ink-900/88 p-5 shadow-panel backdrop-blur md:p-7"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">写作 brief</h2>
            <p className="mt-1 text-sm text-slate-400">
              信息越具体，文章越贴近目标。
            </p>
          </div>
          <span className="rounded-full bg-violet-400/12 px-3 py-1 text-xs text-violet-200">
            SSE 实时进度
          </span>
        </div>

        <label className="block">
          <span className="field-label">作文题目 / 材料</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={6}
            placeholder="例如：阅读下面材料，以“在变化中坚守”为主题写一篇不少于 800 字的文章。"
            className="field-input mt-2 min-h-40 resize-y"
          />
        </label>

        <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_160px]">
          <label className="block">
            <span className="field-label">标题（可选）</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="留空则由 AI 拟题"
              className="field-input mt-2"
            />
          </label>

          <label className="block">
            <span className="field-label">年级</span>
            <select
              value={grade}
              onChange={(event) => setGrade(event.target.value)}
              className="field-input mt-2"
            >
              <option>高一</option>
              <option>高二</option>
              <option>高三</option>
            </select>
          </label>
        </div>

        <label className="mt-5 block">
          <span className="field-label">写作要求（可选）</span>
          <textarea
            value={requirements}
            onChange={(event) => setRequirements(event.target.value)}
            rows={4}
            placeholder="例如：议论文，800-1000 字，语言有文采，素材避免俗套。"
            className="field-input mt-2 resize-y"
          />
        </label>

        <label className="mt-5 flex items-start gap-3 rounded-xl border border-white/10 bg-white/6 p-4">
          <input
            type="checkbox"
            checked={interactive}
            onChange={(event) => setInteractive(event.target.checked)}
            className="mt-1 size-4 rounded border-white/20 bg-ink-950 text-cyan-300 focus:ring-cyan-300"
          />
          <span>
            <span className="block text-sm font-medium text-white">
              交互式写作
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-400">
              在选材、大纲和评审后暂停，确认或补充修改意见后继续。
            </span>
          </span>
        </label>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-ink-950 shadow-glow transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "正在创建任务..." : "Start Writing"}
        </button>
      </form>
    </section>
  );
}

function WritingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const [task, setTask] = useState<WritingTask | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>(createInitialSteps);
  const [error, setError] = useState("");
  const [streamVersion, setStreamVersion] = useState(0);
  const [showModification, setShowModification] = useState(false);
  const [modification, setModification] = useState("");
  const [actionError, setActionError] = useState("");
  const [isActing, setIsActing] = useState(false);

  const completedCount = steps.filter((step) => step.status === "done").length;
  const pausedAgent =
    task?.pausedAtAgent != null ? agentOrder[task.pausedAtAgent] : undefined;
  const pausedResult = pausedAgent
    ? task?.agentResults.find((result) => result.agentName === pausedAgent)
    : undefined;

  useEffect(() => {
    if (!id) return;

    let isActive = true;
    let pollTimer: number | undefined;

    const applyTask = (nextTask: WritingTask) => {
      setTask(nextTask);
      setSteps((current) =>
        current.map((step) => {
          const result = nextTask.agentResults.find(
            (item) => item.agentName === step.id,
          );
          if (result) {
            return {
              ...step,
              status: "done",
              summary: summarize(result.output),
            };
          }
          return nextTask.status === "completed"
            ? { ...step, status: "done" }
            : step;
        }),
      );

      if (nextTask.status === "completed") {
        window.setTimeout(() => navigate(`/result/${nextTask.id}`), 900);
      }
      if (nextTask.status === "failed") {
        setError(nextTask.error ?? "写作任务失败。");
      }
    };

    const fetchTask = async () => {
      const response = await authFetch(auth.token, `/api/writing/${id}`);
      if (!response.ok) {
        if (response.status === 401) {
          auth.logout();
          navigate("/login", { replace: true });
          return;
        }
        throw new Error(`获取任务失败 (${response.status})`);
      }
      const data = (await response.json()) as { task: WritingTask };
      if (isActive) applyTask(data.task);
    };

    const applyProgress = (event: ProgressEvent) => {
      if (event.type === "agent_start" && event.agentName) {
        setSteps((current) =>
          current.map((step) => ({
            ...step,
            status: step.id === event.agentName ? "running" : step.status,
          })),
        );
      }

      if (event.type === "agent_complete" && event.agentName) {
        setSteps((current) =>
          current.map((step) =>
            step.id === event.agentName
              ? {
                  ...step,
                  status: "done",
                  summary: event.output
                    ? summarize(event.output)
                    : step.summary,
                }
              : step,
          ),
        );
      }

      if (event.type === "pipeline_paused" && event.agentName) {
        setSteps((current) =>
          current.map((step) =>
            step.id === event.agentName
              ? {
                  ...step,
                  status: "done",
                  summary: event.output
                    ? summarize(event.output)
                    : step.summary,
                }
              : step,
          ),
        );
        void fetchTask();
      }

      if (event.type === "pipeline_complete") {
        void fetchTask();
      }

      if (event.type === "pipeline_error") {
        setError(event.error ?? "写作任务失败。");
      }
    };

    void fetchTask().catch((caught) => {
      if (isActive) {
        setError(caught instanceof Error ? caught.message : "获取任务失败。");
      }
    });

    const abortController = new AbortController();

    const handleSseFrame = (frame: string) => {
      const eventLine = frame
        .split("\n")
        .find((line) => line.startsWith("event: "));
      const dataLine = frame
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!eventLine || !dataLine || !isActive) return;

      const eventName = eventLine.slice("event: ".length);
      const data = dataLine.slice("data: ".length);
      if (eventName === "task") {
        applyTask(JSON.parse(data) as WritingTask);
      }
      if (eventName === "progress") {
        applyProgress(JSON.parse(data) as ProgressEvent);
      }
    };

    const startStream = async () => {
      const response = await authFetch(
        auth.token,
        `/api/writing/${id}/stream`,
        {
          signal: abortController.signal,
        },
      );
      if (!response.ok || !response.body) {
        throw new Error(`SSE 连接失败 (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (isActive) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          handleSseFrame(frame);
        }
      }
    };

    void startStream().catch((caught) => {
      if (!isActive || abortController.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "SSE 连接失败。");
      pollTimer = window.setInterval(() => {
        void fetchTask().catch((pollError) => {
          setError(
            pollError instanceof Error ? pollError.message : "获取任务失败。",
          );
        });
      }, 1800);
    });

    return () => {
      isActive = false;
      abortController.abort();
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [auth, id, navigate, streamVersion]);

  const submitAction = async (action: "approve" | "modify") => {
    if (!id || !task) return;
    setActionError("");

    if (action === "modify" && !modification.trim()) {
      setActionError("请先填写修改意见。");
      return;
    }

    setIsActing(true);
    try {
      const response = await authFetch(auth.token, `/api/writing/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          agentName: pausedAgent,
          modification:
            action === "modify" ? modification.trim() : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`提交操作失败 (${response.status})`);
      }

      const data = (await response.json()) as { task: WritingTask };
      setTask(data.task);
      setModification("");
      setShowModification(false);
      setStreamVersion((value) => value + 1);
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "提交操作失败。",
      );
    } finally {
      setIsActing(false);
    }
  };

  return (
    <section className="flex flex-1 flex-col py-8 lg:py-10">
      <div className="mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm text-slate-400">Writing task</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">
            Agent 写作进度
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            {task?.topic ?? "正在连接写作任务..."}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/6 px-4 py-3">
          <div className="text-2xl font-semibold text-white">
            {completedCount}
            <span className="text-sm text-slate-400"> / 11</span>
          </div>
          <div className="mt-1 text-xs text-slate-400">已完成步骤</div>
        </div>
      </div>

      <div className="mb-6 h-2 overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-violet-300 transition-all duration-700"
          style={{ width: `${(completedCount / agentOrder.length) * 100}%` }}
        />
      </div>

      {error ? (
        <p className="mb-5 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {task?.status === "paused" && pausedResult ? (
        <section className="mb-6 rounded-xl border border-amber-300/30 bg-amber-300/10 p-5 shadow-soft">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-amber-100">
                等待确认
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">
                {agentLabels[pausedResult.agentName] ?? pausedResult.agentName}
              </h2>
              <p className="mt-1 text-sm text-slate-300">
                {task.pauseReason === "review_materials"
                  ? "请确认素材是否合适，或补充替换方向。"
                  : task.pauseReason === "review_outline"
                    ? "请确认大纲结构是否合适，或提出调整意见。"
                    : "请确认评审意见，或补充下一轮修改要求。"}
              </p>
            </div>
            <span className="rounded-full border border-amber-200/30 bg-black/20 px-3 py-1 text-xs text-amber-100">
              {pausedResult.agentName}
            </span>
          </div>

          <div className="mt-5 max-h-80 overflow-auto rounded-lg border border-white/10 bg-ink-950/70 p-4">
            <pre className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-200">
              {pausedResult.output}
            </pre>
          </div>

          {showModification ? (
            <label className="mt-5 block">
              <span className="field-label">修改意见</span>
              <textarea
                value={modification}
                onChange={(event) => setModification(event.target.value)}
                rows={4}
                placeholder="例如：请把第二个素材换成航天工程案例，并让大纲更突出递进关系。"
                className="field-input mt-2 resize-y"
              />
            </label>
          ) : null}

          {actionError ? (
            <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {actionError}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={isActing}
              onClick={() => void submitAction("approve")}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-ink-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isActing ? "提交中..." : "Approve and Continue"}
            </button>
            {showModification ? (
              <button
                type="button"
                disabled={isActing}
                onClick={() => void submitAction("modify")}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-amber-200/30 bg-amber-200/12 px-5 text-sm font-semibold text-amber-50 transition hover:bg-amber-200/18 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Submit Changes
              </button>
            ) : (
              <button
                type="button"
                disabled={isActing}
                onClick={() => setShowModification(true)}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-white/12 bg-white/8 px-5 text-sm font-semibold text-white transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Request Changes
              </button>
            )}
          </div>
        </section>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {steps.map((step, index) => (
          <AgentStepCard key={step.id} step={step} index={index} />
        ))}
      </div>
    </section>
  );
}

function AgentStepCard({ step, index }: { step: AgentStep; index: number }) {
  const statusText = {
    waiting: "等待中",
    running: "运行中",
    done: "已完成",
  }[step.status];

  return (
    <article
      className={[
        "group rounded-xl border p-4 transition-all duration-500",
        step.status === "running"
          ? "border-cyan-300/40 bg-cyan-300/10 shadow-glow"
          : "border-white/10 bg-white/6",
        step.status === "done" ? "border-emerald-300/30 bg-emerald-300/8" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-4">
        <div
          className={[
            "grid size-9 shrink-0 place-items-center rounded-lg text-sm font-semibold transition",
            step.status === "done"
              ? "bg-emerald-300 text-ink-950"
              : step.status === "running"
                ? "animate-pulse bg-cyan-300 text-ink-950"
                : "bg-white/10 text-slate-300",
          ].join(" ")}
        >
          {step.status === "done" ? "✓" : index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium text-white">{step.name}</h2>
            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-xs text-slate-300">
              {statusText}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{step.id}</p>
          {step.summary ? (
            <p className="mt-3 animate-fade-in text-sm leading-6 text-slate-300">
              {step.summary}
            </p>
          ) : (
            <div className="mt-4 h-2 w-2/3 rounded-full bg-white/8" />
          )}
        </div>
      </div>
    </article>
  );
}

function ResultPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const [task, setTask] = useState<WritingTask | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;

    const fetchResult = async () => {
      const response = await authFetch(auth.token, `/api/writing/${id}`);
      if (!response.ok) {
        if (response.status === 401) {
          auth.logout();
          navigate("/login", { replace: true });
          return;
        }
        throw new Error(`获取结果失败 (${response.status})`);
      }
      const data = (await response.json()) as { task: WritingTask };
      setTask(data.task);
    };

    void fetchResult().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "获取结果失败。");
    });
  }, [auth, id, navigate]);

  const essay = useMemo(() => {
    if (task?.result) return task.result;
    return task?.agentResults.at(-1)?.output ?? "";
  }, [task]);

  const handleCopy = async () => {
    if (!essay) return;
    await navigator.clipboard.writeText(essay);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section className="flex flex-1 flex-col py-8 lg:py-10">
      <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm text-slate-400">Final essay</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">作文终稿</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            {task?.topic ?? "正在读取写作结果..."}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!essay}
            className="rounded-xl border border-white/12 bg-white/8 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/12 disabled:opacity-50"
          >
            {copied ? "已复制" : "复制"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-cyan-200"
          >
            Rewrite
          </button>
        </div>
      </div>

      {error ? (
        <p className="mb-5 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <article className="mx-auto w-full max-w-4xl rounded-2xl border border-white/12 bg-[#f8fafc] px-5 py-7 text-slate-950 shadow-panel sm:px-8 md:px-12 md:py-10">
        {essay ? (
          <div className="prose-essay">
            {essayParagraphs(essay).map((paragraph, index) => (
              <p key={`${paragraph.slice(0, 16)}-${index}`}>{paragraph}</p>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="h-4 w-2/3 animate-pulse rounded-full bg-slate-200" />
            <div className="h-4 w-full animate-pulse rounded-full bg-slate-200" />
            <div className="h-4 w-5/6 animate-pulse rounded-full bg-slate-200" />
          </div>
        )}
      </article>
    </section>
  );
}

export default App;

interface ConfigResponse {
  config: {
    baseUrl: string;
    apiKeyMasked: string;
    model: string;
    updatedAt: string;
  } | null;
}

function SettingsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("glm-5.1");
  const [savedConfig, setSavedConfig] =
    useState<ConfigResponse["config"]>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await authFetch(auth.token, "/api/config");
        if (res.status === 401) {
          auth.logout();
          navigate("/login", { replace: true });
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as ConfigResponse;
        if (data.config) {
          setSavedConfig(data.config);
          setBaseUrl(data.config.baseUrl);
          setModel(data.config.model);
          // Don't fill apiKey — user must re-enter to update
        }
      } catch {
        // ignore
      }
    };
    void load();
  }, [auth, navigate]);

  const handleSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage(null);
    if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) {
      setMessage({ type: "err", text: "All fields are required." });
      return;
    }
    setIsSaving(true);
    try {
      const res = await authFetch(auth.token, "/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: baseUrl.trim().replace(/\/+$/, ""),
          apiKey: apiKey.trim(),
          model: model.trim(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ConfigResponse;
      setSavedConfig(data.config);
      setApiKey("");
      setMessage({ type: "ok", text: "Configuration saved successfully!" });
    } catch (caught) {
      setMessage({
        type: "err",
        text: caught instanceof Error ? caught.message : "Save failed.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const testRes = await fetch(
        `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "say ok" }],
            max_tokens: 5,
          }),
        },
      );
      if (testRes.ok) {
        setMessage({ type: "ok", text: "LLM connection test passed!" });
      } else {
        const body = await testRes.text();
        setMessage({
          type: "err",
          text: `Connection failed (${testRes.status}): ${body.slice(0, 120)}`,
        });
      }
    } catch (caught) {
      setMessage({
        type: "err",
        text: `Connection error: ${caught instanceof Error ? caught.message : "unknown"}`,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="flex flex-1 flex-col py-8 lg:py-10">
      <div className="mb-8">
        <p className="text-sm text-slate-400">Configuration</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">LLM Settings</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
          Configure the OpenAI-compatible LLM API endpoint. The API key is
          stored server-side and never exposed to the browser after saving.
        </p>
      </div>

      <div className="w-full max-w-xl rounded-2xl border border-white/12 bg-ink-900/88 p-5 shadow-panel backdrop-blur md:p-7">
        {savedConfig ? (
          <div className="mb-6 rounded-xl border border-emerald-300/20 bg-emerald-300/8 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-emerald-200">
              <span className="size-2 rounded-full bg-emerald-400" />
              Configured
            </div>
            <div className="mt-2 space-y-1 text-xs text-slate-300">
              <p>
                Base URL:{" "}
                <span className="text-white">{savedConfig.baseUrl}</span>
              </p>
              <p>
                API Key:{" "}
                <span className="font-mono text-white">
                  {savedConfig.apiKeyMasked}
                </span>
              </p>
              <p>
                Model: <span className="text-white">{savedConfig.model}</span>
              </p>
              <p>Last updated: {savedConfig.updatedAt}</p>
            </div>
          </div>
        ) : (
          <div className="mb-6 rounded-xl border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-sm text-amber-200">
            No LLM configured yet. Fill in the form below to get started.
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-5">
          <label className="block">
            <span className="field-label">Base URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openrouter.ai or http://your-server:3001"
              className="field-input mt-2"
            />
          </label>

          <label className="block">
            <span className="field-label">API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                savedConfig ? "Enter new key to update" : "sk-xxx..."
              }
              className="field-input mt-2"
            />
          </label>

          <label className="block">
            <span className="field-label">Model</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. glm-5.1, gpt-4o, deepseek-chat"
              className="field-input mt-2"
            />
          </label>

          {message ? (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${message.type === "ok" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-red-400/30 bg-red-500/10 text-red-200"}`}
            >
              {message.text}
            </div>
          ) : null}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-ink-950 shadow-glow transition hover:bg-cyan-200 disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !baseUrl || !apiKey || !model}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-white/12 bg-white/8 px-5 text-sm font-medium text-white transition hover:bg-white/12 disabled:opacity-50"
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
