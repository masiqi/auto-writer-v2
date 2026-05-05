import { FormEvent, useEffect, useMemo, useState } from "react";
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

type TaskStatus = "pending" | "running" | "completed" | "failed";
type AgentStatus = "waiting" | "running" | "done";

interface WritingTask {
  id: string;
  topic: string;
  requirements?: string;
  status: TaskStatus;
  result?: string;
  error?: string;
  agentResults: AgentResult[];
  createdAt: string;
  updatedAt: string;
}

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

const summarize = (value: string): string => {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 92 ? `${compact.slice(0, 92)}...` : compact;
};

const essayParagraphs = (essay: string): string[] =>
  essay
    .split(/\n{2,}|\r\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="writing/:id" element={<WritingPage />} />
          <Route path="result/:id" element={<ResultPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function Shell() {
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
              <span className="text-xs text-slate-400">高中作文多智能体助手</span>
            </span>
          </Link>
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-slate-300 sm:flex">
            <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.8)]" />
            11 个 Agent 协同写作
          </div>
        </header>

        <Outlet />
      </div>
    </main>
  );
}

function HomePage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [grade, setGrade] = useState("高一");
  const [requirements, setRequirements] = useState("");
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
      const response = await fetch(apiPath("/api/writing"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          title: title.trim() || undefined,
          grade,
          requirements: requirements.trim() || undefined,
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
            <p className="mt-1 text-sm text-slate-400">信息越具体，文章越贴近目标。</p>
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
  const [task, setTask] = useState<WritingTask | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>(createInitialSteps);
  const [error, setError] = useState("");

  const completedCount = steps.filter((step) => step.status === "done").length;

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
            return { ...step, status: "done", summary: summarize(result.output) };
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
      const response = await fetch(apiPath(`/api/writing/${id}`));
      if (!response.ok) {
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
                  summary: event.output ? summarize(event.output) : step.summary,
                }
              : step,
          ),
        );
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

    const source = new EventSource(apiPath(`/api/writing/${id}/stream`));
    source.addEventListener("task", (message) => {
      if (!isActive) return;
      applyTask(JSON.parse(message.data) as WritingTask);
    });
    source.addEventListener("progress", (message) => {
      if (!isActive) return;
      applyProgress(JSON.parse(message.data) as ProgressEvent);
    });
    source.onerror = () => {
      source.close();
      if (!isActive) return;
      pollTimer = window.setInterval(() => {
        void fetchTask().catch((caught) => {
          setError(caught instanceof Error ? caught.message : "获取任务失败。");
        });
      }, 1800);
    };

    return () => {
      isActive = false;
      source.close();
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [id, navigate]);

  return (
    <section className="flex flex-1 flex-col py-8 lg:py-10">
      <div className="mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm text-slate-400">Writing task</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Agent 写作进度</h1>
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
  const [task, setTask] = useState<WritingTask | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;

    const fetchResult = async () => {
      const response = await fetch(apiPath(`/api/writing/${id}`));
      if (!response.ok) {
        throw new Error(`获取结果失败 (${response.status})`);
      }
      const data = (await response.json()) as { task: WritingTask };
      setTask(data.task);
    };

    void fetchResult().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "获取结果失败。");
    });
  }, [id]);

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
