import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useMemo, useState, } from "react";
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useNavigate, useParams, } from "react-router-dom";
const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const AUTH_TOKEN_KEY = "auto-writer-v2:jwt";
const AUTH_EMAIL_KEY = "auto-writer-v2:email";
const agentLabels = {
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
const createInitialSteps = () => agentOrder.map((id) => ({ id, name: agentLabels[id], status: "waiting" }));
const apiPath = (path) => `${API_BASE_URL}${path}`;
const AuthContext = createContext(null);
const useAuth = () => {
    const auth = useContext(AuthContext);
    if (!auth) {
        throw new Error("AuthContext is missing");
    }
    return auth;
};
const authFetch = (token, path, init = {}) => {
    const headers = new Headers(init.headers);
    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(apiPath(path), { ...init, headers });
};
const summarize = (value) => {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 92 ? `${compact.slice(0, 92)}...` : compact;
};
const essayParagraphs = (essay) => essay
    .split(/\n{2,}|\r\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
const statusLabels = {
    pending: "等待中",
    running: "写作中",
    paused: "待确认",
    completed: "已完成",
    failed: "失败",
};
const statusBadgeClasses = {
    pending: "border-slate-300/20 bg-slate-300/10 text-slate-200",
    running: "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
    paused: "border-amber-300/30 bg-amber-300/10 text-amber-100",
    completed: "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
    failed: "border-red-300/30 bg-red-400/10 text-red-200",
};
const formatDateTime = (value) => new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
}).format(new Date(value));
function App() {
    const [token, setToken] = useState(() => localStorage.getItem(AUTH_TOKEN_KEY));
    const [userEmail, setUserEmail] = useState(() => localStorage.getItem(AUTH_EMAIL_KEY) ?? "");
    const auth = useMemo(() => ({
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
    }), [token, userEmail]);
    return (_jsx(AuthContext.Provider, { value: auth, children: _jsx(BrowserRouter, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(AuthShell, { children: _jsx(LoginPage, {}) }) }), _jsx(Route, { path: "/register", element: _jsx(AuthShell, { children: _jsx(RegisterPage, {}) }) }), _jsxs(Route, { path: "/", element: _jsx(ProtectedShell, {}), children: [_jsx(Route, { index: true, element: _jsx(HomePage, {}) }), _jsx(Route, { path: "history", element: _jsx(HistoryPage, {}) }), _jsx(Route, { path: "writing/:id", element: _jsx(WritingPage, {}) }), _jsx(Route, { path: "result/:id", element: _jsx(ResultPage, {}) }), _jsx(Route, { path: "settings", element: _jsx(SettingsPage, {}) })] }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }) }) }));
}
function ProtectedShell() {
    const auth = useAuth();
    if (!auth.isLoggedIn) {
        return _jsx(Navigate, { to: "/login", replace: true });
    }
    return _jsx(Shell, {});
}
function AuthShell({ children }) {
    return (_jsxs("main", { className: "min-h-screen overflow-hidden bg-ink-950 text-slate-100", children: [_jsx("div", { className: "fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.14),transparent_28%),linear-gradient(180deg,#09090b_0%,#111827_52%,#09090b_100%)]" }), _jsx("div", { className: "mx-auto grid min-h-screen w-full max-w-7xl place-items-center px-4 py-8 sm:px-6 lg:px-8", children: children })] }));
}
function Shell() {
    const auth = useAuth();
    const navigate = useNavigate();
    const handleLogout = () => {
        auth.logout();
        navigate("/login", { replace: true });
    };
    return (_jsxs("main", { className: "min-h-screen overflow-hidden bg-ink-950 text-slate-100", children: [_jsx("div", { className: "fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.14),transparent_28%),linear-gradient(180deg,#09090b_0%,#111827_52%,#09090b_100%)]" }), _jsxs("div", { className: "mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8", children: [_jsxs("header", { className: "flex items-center justify-between border-b border-white/10 pb-4", children: [_jsxs(Link, { to: "/", className: "group flex items-center gap-3", children: [_jsx("span", { className: "grid size-9 place-items-center rounded-xl border border-white/12 bg-white/8 text-sm font-semibold text-cyan-200 shadow-soft transition group-hover:border-cyan-300/50", children: "\u6587" }), _jsxs("span", { children: [_jsx("span", { className: "block text-sm font-semibold tracking-wide text-white", children: "Auto Writer V2" }), _jsx("span", { className: "text-xs text-slate-400", children: "\u9AD8\u4E2D\u4F5C\u6587\u591A\u667A\u80FD\u4F53\u52A9\u624B" })] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "hidden max-w-48 truncate text-xs text-slate-300 sm:inline", children: auth.userEmail }), _jsx(Link, { to: "/history", className: "flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/10 sm:flex", children: "History" }), _jsxs(Link, { to: "/settings", className: "flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/10 sm:flex", children: [_jsx("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 16 16", fill: "currentColor", className: "size-3.5", children: _jsx("path", { fillRule: "evenodd", d: "M6.955 1.45A.5.5 0 0 1 7.452 1h1.096a.5.5 0 0 1 .497.45l.186 1.436c.372.14.722.327 1.042.548l1.37-.52a.5.5 0 0 1 .613.229l.548.95a.5.5 0 0 1-.116.626l-1.108.876c.057.388.057.78 0 1.168l1.108.876a.5.5 0 0 1 .116.625l-.548.95a.5.5 0 0 1-.613.23l-1.37-.521c-.32.22-.67.407-1.042.548l-.186 1.436a.5.5 0 0 1-.497.45H7.452a.5.5 0 0 1-.497-.45l-.186-1.436a4.5 4.5 0 0 1-1.042-.548l-1.37.52a.5.5 0 0 1-.613-.229l-.548-.95a.5.5 0 0 1 .116-.626l1.108-.876a4.5 4.5 0 0 1 0-1.168l-1.108-.876a.5.5 0 0 1-.116-.625l.548-.95a.5.5 0 0 1 .613-.23l1.37.521c.32-.22.67-.407 1.042-.548l.186-1.436ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", clipRule: "evenodd" }) }), "Settings"] }), _jsx("button", { type: "button", onClick: handleLogout, className: "rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/10", children: "Logout" }), _jsxs("span", { className: "hidden items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-slate-300 sm:flex", children: [_jsx("span", { className: "size-2 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.8)]" }), "11 Agents"] })] })] }), _jsx(Outlet, {})] })] }));
}
function LoginPage() {
    return _jsx(AuthForm, { mode: "login" });
}
function RegisterPage() {
    return _jsx(AuthForm, { mode: "register" });
}
function AuthForm({ mode }) {
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
    const handleSubmit = async (event) => {
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
                throw new Error(isRegister
                    ? "注册失败，请检查邮箱和密码。"
                    : "登录失败，请检查邮箱和密码。");
            }
            const data = (await response.json());
            auth.login(data.token, data.user.email);
            navigate("/", { replace: true });
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : "请求失败。");
        }
        finally {
            setIsSubmitting(false);
        }
    };
    return (_jsxs("section", { className: "w-full max-w-md rounded-2xl border border-white/12 bg-ink-900/88 p-6 shadow-panel backdrop-blur md:p-8", children: [_jsxs(Link, { to: "/", className: "mb-7 flex items-center gap-3", children: [_jsx("span", { className: "grid size-9 place-items-center rounded-xl border border-white/12 bg-white/8 text-sm font-semibold text-cyan-200 shadow-soft", children: "\u6587" }), _jsxs("span", { children: [_jsx("span", { className: "block text-sm font-semibold tracking-wide text-white", children: "Auto Writer V2" }), _jsx("span", { className: "text-xs text-slate-400", children: "\u9AD8\u4E2D\u4F5C\u6587\u591A\u667A\u80FD\u4F53\u52A9\u624B" })] })] }), _jsxs("div", { className: "mb-6", children: [_jsx("p", { className: "text-sm text-slate-400", children: "Account" }), _jsx("h1", { className: "mt-2 text-3xl font-semibold text-white", children: isRegister ? "创建账号" : "登录" })] }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-5", children: [_jsxs("label", { className: "block", children: [_jsx("span", { className: "field-label", children: "Email" }), _jsx("input", { type: "email", value: email, onChange: (event) => setEmail(event.target.value), autoComplete: "email", className: "field-input mt-2" })] }), _jsxs("label", { className: "block", children: [_jsx("span", { className: "field-label", children: "Password" }), _jsx("input", { type: "password", value: password, onChange: (event) => setPassword(event.target.value), autoComplete: isRegister ? "new-password" : "current-password", className: "field-input mt-2" })] }), error ? (_jsx("p", { className: "rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200", children: error })) : null, _jsx("button", { type: "submit", disabled: isSubmitting, className: "inline-flex h-12 w-full items-center justify-center rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-ink-950 shadow-glow transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60", children: isSubmitting ? "提交中..." : isRegister ? "Register" : "Login" })] }), _jsxs("p", { className: "mt-5 text-center text-sm text-slate-400", children: [isRegister ? "Already have an account?" : "Need an account?", " ", _jsx(Link, { to: isRegister ? "/login" : "/register", className: "font-medium text-cyan-200 hover:text-cyan-100", children: isRegister ? "Login" : "Register" })] })] }));
}
function HistoryPage() {
    const auth = useAuth();
    const navigate = useNavigate();
    const [tasks, setTasks] = useState([]);
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
            const data = (await response.json());
            if (isActive) {
                setTasks(data.tasks);
            }
        };
        void loadTasks()
            .catch((caught) => {
            if (isActive) {
                setError(caught instanceof Error ? caught.message : "获取历史任务失败。");
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
    return (_jsxs("section", { className: "flex flex-1 flex-col py-8 lg:py-10", children: [_jsxs("div", { className: "mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm text-slate-400", children: "Writing history" }), _jsx("h1", { className: "mt-2 text-3xl font-semibold text-white", children: "\u5386\u53F2\u4EFB\u52A1" }), _jsx("p", { className: "mt-2 max-w-2xl text-sm leading-6 text-slate-300", children: "\u67E5\u770B\u5F53\u524D\u8D26\u53F7\u521B\u5EFA\u8FC7\u7684\u4F5C\u6587\u4EFB\u52A1\uFF0C\u7EE7\u7EED\u67E5\u770B\u8FDB\u5EA6\u6216\u6253\u5F00\u5DF2\u751F\u6210\u7684\u7EC8\u7A3F\u3002" })] }), _jsx(Link, { to: "/", className: "inline-flex h-11 items-center justify-center rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-ink-950 shadow-glow transition hover:bg-cyan-200", children: "New Task" })] }), error ? (_jsx("p", { className: "mb-5 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200", children: error })) : null, isLoading ? (_jsx("div", { className: "space-y-3", children: [0, 1, 2].map((item) => (_jsx("div", { className: "h-24 animate-pulse rounded-xl border border-white/10 bg-white/6" }, item))) })) : tasks.length === 0 ? (_jsxs("div", { className: "rounded-2xl border border-white/12 bg-ink-900/88 p-7 text-center shadow-panel backdrop-blur", children: [_jsx("h2", { className: "text-lg font-semibold text-white", children: "\u6682\u65E0\u5386\u53F2\u4EFB\u52A1" }), _jsx("p", { className: "mt-2 text-sm text-slate-400", children: "\u521B\u5EFA\u7B2C\u4E00\u7BC7\u4F5C\u6587\u540E\uFF0C\u4EFB\u52A1\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002" })] })) : (_jsx("div", { className: "space-y-3", children: tasks.map((task) => (_jsx(HistoryTaskItem, { task: task }, task.id))) }))] }));
}
function HistoryTaskItem({ task }) {
    const target = task.status === "running" || task.status === "pending"
        ? `/writing/${task.id}`
        : `/result/${task.id}`;
    const preview = task.error ?? task.result ?? task.requirements ?? task.topic;
    return (_jsx(Link, { to: target, className: "group block rounded-xl border border-white/10 bg-white/6 p-4 transition hover:border-cyan-300/30 hover:bg-white/10", children: _jsxs("div", { className: "flex flex-col gap-3 md:flex-row md:items-start md:justify-between", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [_jsx("span", { className: `rounded-full border px-2.5 py-1 text-xs ${statusBadgeClasses[task.status]}`, children: statusLabels[task.status] }), _jsxs("span", { className: "text-xs text-slate-500", children: ["\u521B\u5EFA\u4E8E ", formatDateTime(task.createdAt)] }), _jsxs("span", { className: "text-xs text-slate-500", children: ["\u66F4\u65B0\u4E8E ", formatDateTime(task.updatedAt)] })] }), _jsx("h2", { className: "mt-3 line-clamp-2 text-base font-semibold leading-6 text-white transition group-hover:text-cyan-100", children: task.topic }), _jsx("p", { className: "mt-2 line-clamp-2 text-sm leading-6 text-slate-400", children: preview })] }), _jsx("span", { className: "shrink-0 text-sm text-cyan-200 transition group-hover:translate-x-1", children: "\u67E5\u770B" })] }) }));
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
    const handleSubmit = async (event) => {
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
            const data = (await response.json());
            navigate(`/writing/${data.task.id}`);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : "创建写作任务失败。");
        }
        finally {
            setIsSubmitting(false);
        }
    };
    return (_jsxs("section", { className: "grid flex-1 items-center gap-10 py-10 lg:grid-cols-[0.95fr_1.05fr] lg:py-16", children: [_jsxs("div", { className: "max-w-xl", children: [_jsx("p", { className: "mb-4 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-200", children: "\u4ECE\u5BA1\u9898\u5230\u7EC8\u7A3F\uFF0C\u4E00\u6B21\u5B8C\u6210" }), _jsx("h1", { className: "text-balance text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl", children: "\u9762\u5411\u9AD8\u4E2D\u4F5C\u6587\u7684 AI \u5199\u4F5C\u5DE5\u4F5C\u53F0" }), _jsx("p", { className: "mt-5 max-w-lg text-base leading-8 text-slate-300", children: "\u8F93\u5165\u9898\u76EE\u3001\u5E74\u7EA7\u548C\u5199\u4F5C\u8981\u6C42\uFF0C\u7CFB\u7EDF\u4F1A\u6309\u5BA1\u9898\u3001\u7ACB\u610F\u3001\u9009\u6750\u3001\u5927\u7EB2\u3001\u6210\u6587\u3001\u8BC4\u5BA1\u548C\u4FEE\u6539\u7684\u987A\u5E8F\u751F\u6210\u4E00\u7BC7\u5B8C\u6574\u4F5C\u6587\u3002" }), _jsx("div", { className: "mt-8 grid grid-cols-3 gap-3 text-center", children: ["审题", "成文", "评审"].map((item) => (_jsxs("div", { className: "rounded-lg border border-white/10 bg-white/6 px-3 py-4", children: [_jsx("div", { className: "text-lg font-semibold text-white", children: item }), _jsx("div", { className: "mt-1 text-xs text-slate-400", children: "Agent \u9636\u6BB5" })] }, item))) })] }), _jsxs("form", { onSubmit: handleSubmit, className: "rounded-2xl border border-white/12 bg-ink-900/88 p-5 shadow-panel backdrop-blur md:p-7", children: [_jsxs("div", { className: "mb-6 flex items-start justify-between gap-4", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-semibold text-white", children: "\u5199\u4F5C brief" }), _jsx("p", { className: "mt-1 text-sm text-slate-400", children: "\u4FE1\u606F\u8D8A\u5177\u4F53\uFF0C\u6587\u7AE0\u8D8A\u8D34\u8FD1\u76EE\u6807\u3002" })] }), _jsx("span", { className: "rounded-full bg-violet-400/12 px-3 py-1 text-xs text-violet-200", children: "SSE \u5B9E\u65F6\u8FDB\u5EA6" })] }), _jsxs("label", { className: "block", children: [_jsx("span", { className: "field-label", children: "\u4F5C\u6587\u9898\u76EE / \u6750\u6599" }), _jsx("textarea", { value: prompt, onChange: (event) => setPrompt(event.target.value), rows: 6, placeholder: "\u4F8B\u5982\uFF1A\u9605\u8BFB\u4E0B\u9762\u6750\u6599\uFF0C\u4EE5\u201C\u5728\u53D8\u5316\u4E2D\u575A\u5B88\u201D\u4E3A\u4E3B\u9898\u5199\u4E00\u7BC7\u4E0D\u5C11\u4E8E 800 \u5B57\u7684\u6587\u7AE0\u3002", className: "field-input mt-2 min-h-40 resize-y" })] }), _jsxs("div", { className: "mt-5 grid gap-4 sm:grid-cols-[1fr_160px]", children: [_jsxs("label", { className: "block", children: [_jsx("span", { className: "field-label", children: "\u6807\u9898\uFF08\u53EF\u9009\uFF09" }), _jsx("input", { value: title, onChange: (event) => setTitle(event.target.value), placeholder: "\u7559\u7A7A\u5219\u7531 AI \u62DF\u9898", className: "field-input mt-2" })] }), _jsxs("label", { className: "block", children: [_jsx("span", { className: "field-label", children: "\u5E74\u7EA7" }), _jsxs("select", { value: grade, onChange: (event) => setGrade(event.target.value), className: "field-input mt-2", children: [_jsx("option", { children: "\u9AD8\u4E00" }), _jsx("option", { children: "\u9AD8\u4E8C" }), _jsx("option", { children: "\u9AD8\u4E09" })] })] })] }), _jsxs("label", { className: "mt-5 block", children: [_jsx("span", { className: "field-label", children: "\u5199\u4F5C\u8981\u6C42\uFF08\u53EF\u9009\uFF09" }), _jsx("textarea", { value: requirements, onChange: (event) => setRequirements(event.target.value), rows: 4, placeholder: "\u4F8B\u5982\uFF1A\u8BAE\u8BBA\u6587\uFF0C800-1000 \u5B57\uFF0C\u8BED\u8A00\u6709\u6587\u91C7\uFF0C\u7D20\u6750\u907F\u514D\u4FD7\u5957\u3002", className: "field-input mt-2 resize-y" })] }), _jsxs("label", { className: "mt-5 flex items-start gap-3 rounded-xl border border-white/10 bg-white/6 p-4", children: [_jsx("input", { type: "checkbox", checked: interactive, onChange: (event) => setInteractive(event.target.checked), className: "mt-1 size-4 rounded border-white/20 bg-ink-950 text-cyan-300 focus:ring-cyan-300" }), _jsxs("span", { children: [_jsx("span", { className: "block text-sm font-medium text-white", children: "\u4EA4\u4E92\u5F0F\u5199\u4F5C" }), _jsx("span", { className: "mt-1 block text-xs leading-5 text-slate-400", children: "\u5728\u9009\u6750\u3001\u5927\u7EB2\u548C\u8BC4\u5BA1\u540E\u6682\u505C\uFF0C\u786E\u8BA4\u6216\u8865\u5145\u4FEE\u6539\u610F\u89C1\u540E\u7EE7\u7EED\u3002" })] })] }), error ? (_jsx("p", { className: "mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200", children: error })) : null, _jsx("button", { type: "submit", disabled: isSubmitting, className: "mt-6 inline-flex h-12 w-full items-center justify-center rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-ink-950 shadow-glow transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60", children: isSubmitting ? "正在创建任务..." : "Start Writing" })] })] }));
}
function WritingPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const auth = useAuth();
    const [task, setTask] = useState(null);
    const [steps, setSteps] = useState(createInitialSteps);
    const [error, setError] = useState("");
    const [streamVersion, setStreamVersion] = useState(0);
    const [showModification, setShowModification] = useState(false);
    const [modification, setModification] = useState("");
    const [actionError, setActionError] = useState("");
    const [isActing, setIsActing] = useState(false);
    const completedCount = steps.filter((step) => step.status === "done").length;
    const pausedAgent = task?.pausedAtAgent != null ? agentOrder[task.pausedAtAgent] : undefined;
    const pausedResult = pausedAgent
        ? task?.agentResults.find((result) => result.agentName === pausedAgent)
        : undefined;
    useEffect(() => {
        if (!id)
            return;
        let isActive = true;
        let pollTimer;
        const applyTask = (nextTask) => {
            setTask(nextTask);
            setSteps((current) => current.map((step) => {
                const result = nextTask.agentResults.find((item) => item.agentName === step.id);
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
            }));
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
            const data = (await response.json());
            if (isActive)
                applyTask(data.task);
        };
        const applyProgress = (event) => {
            if (event.type === "agent_start" && event.agentName) {
                setSteps((current) => current.map((step) => ({
                    ...step,
                    status: step.id === event.agentName ? "running" : step.status,
                })));
            }
            if (event.type === "agent_complete" && event.agentName) {
                setSteps((current) => current.map((step) => step.id === event.agentName
                    ? {
                        ...step,
                        status: "done",
                        summary: event.output
                            ? summarize(event.output)
                            : step.summary,
                    }
                    : step));
            }
            if (event.type === "pipeline_paused" && event.agentName) {
                setSteps((current) => current.map((step) => step.id === event.agentName
                    ? {
                        ...step,
                        status: "done",
                        summary: event.output
                            ? summarize(event.output)
                            : step.summary,
                    }
                    : step));
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
        const handleSseFrame = (frame) => {
            const eventLine = frame
                .split("\n")
                .find((line) => line.startsWith("event: "));
            const dataLine = frame
                .split("\n")
                .find((line) => line.startsWith("data: "));
            if (!eventLine || !dataLine || !isActive)
                return;
            const eventName = eventLine.slice("event: ".length);
            const data = dataLine.slice("data: ".length);
            if (eventName === "task") {
                applyTask(JSON.parse(data));
            }
            if (eventName === "progress") {
                applyProgress(JSON.parse(data));
            }
        };
        const startStream = async () => {
            const response = await authFetch(auth.token, `/api/writing/${id}/stream`, {
                signal: abortController.signal,
            });
            if (!response.ok || !response.body) {
                throw new Error(`SSE 连接失败 (${response.status})`);
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (isActive) {
                const chunk = await reader.read();
                if (chunk.done)
                    break;
                buffer += decoder.decode(chunk.value, { stream: true });
                const frames = buffer.split("\n\n");
                buffer = frames.pop() ?? "";
                for (const frame of frames) {
                    handleSseFrame(frame);
                }
            }
        };
        void startStream().catch((caught) => {
            if (!isActive || abortController.signal.aborted)
                return;
            setError(caught instanceof Error ? caught.message : "SSE 连接失败。");
            pollTimer = window.setInterval(() => {
                void fetchTask().catch((pollError) => {
                    setError(pollError instanceof Error ? pollError.message : "获取任务失败。");
                });
            }, 1800);
        });
        return () => {
            isActive = false;
            abortController.abort();
            if (pollTimer)
                window.clearInterval(pollTimer);
        };
    }, [auth, id, navigate, streamVersion]);
    const submitAction = async (action) => {
        if (!id || !task)
            return;
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
                    modification: action === "modify" ? modification.trim() : undefined,
                }),
            });
            if (!response.ok) {
                throw new Error(`提交操作失败 (${response.status})`);
            }
            const data = (await response.json());
            setTask(data.task);
            setModification("");
            setShowModification(false);
            setStreamVersion((value) => value + 1);
        }
        catch (caught) {
            setActionError(caught instanceof Error ? caught.message : "提交操作失败。");
        }
        finally {
            setIsActing(false);
        }
    };
    return (_jsxs("section", { className: "flex flex-1 flex-col py-8 lg:py-10", children: [_jsxs("div", { className: "mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-end", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm text-slate-400", children: "Writing task" }), _jsx("h1", { className: "mt-2 text-3xl font-semibold text-white", children: "Agent \u5199\u4F5C\u8FDB\u5EA6" }), _jsx("p", { className: "mt-2 max-w-2xl text-sm leading-6 text-slate-300", children: task?.topic ?? "正在连接写作任务..." })] }), _jsxs("div", { className: "rounded-xl border border-white/10 bg-white/6 px-4 py-3", children: [_jsxs("div", { className: "text-2xl font-semibold text-white", children: [completedCount, _jsx("span", { className: "text-sm text-slate-400", children: " / 11" })] }), _jsx("div", { className: "mt-1 text-xs text-slate-400", children: "\u5DF2\u5B8C\u6210\u6B65\u9AA4" })] })] }), _jsx("div", { className: "mb-6 h-2 overflow-hidden rounded-full bg-white/8", children: _jsx("div", { className: "h-full rounded-full bg-gradient-to-r from-cyan-300 to-violet-300 transition-all duration-700", style: { width: `${(completedCount / agentOrder.length) * 100}%` } }) }), error ? (_jsx("p", { className: "mb-5 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200", children: error })) : null, task?.status === "paused" && pausedResult ? (_jsxs("section", { className: "mb-6 rounded-xl border border-amber-300/30 bg-amber-300/10 p-5 shadow-soft", children: [_jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs font-medium uppercase tracking-wide text-amber-100", children: "\u7B49\u5F85\u786E\u8BA4" }), _jsx("h2", { className: "mt-2 text-xl font-semibold text-white", children: agentLabels[pausedResult.agentName] ?? pausedResult.agentName }), _jsx("p", { className: "mt-1 text-sm text-slate-300", children: task.pauseReason === "review_materials"
                                            ? "请确认素材是否合适，或补充替换方向。"
                                            : task.pauseReason === "review_outline"
                                                ? "请确认大纲结构是否合适，或提出调整意见。"
                                                : "请确认评审意见，或补充下一轮修改要求。" })] }), _jsx("span", { className: "rounded-full border border-amber-200/30 bg-black/20 px-3 py-1 text-xs text-amber-100", children: pausedResult.agentName })] }), _jsx("div", { className: "mt-5 max-h-80 overflow-auto rounded-lg border border-white/10 bg-ink-950/70 p-4", children: _jsx("pre", { className: "whitespace-pre-wrap break-words text-sm leading-7 text-slate-200", children: pausedResult.output }) }), showModification ? (_jsxs("label", { className: "mt-5 block", children: [_jsx("span", { className: "field-label", children: "\u4FEE\u6539\u610F\u89C1" }), _jsx("textarea", { value: modification, onChange: (event) => setModification(event.target.value), rows: 4, placeholder: "\u4F8B\u5982\uFF1A\u8BF7\u628A\u7B2C\u4E8C\u4E2A\u7D20\u6750\u6362\u6210\u822A\u5929\u5DE5\u7A0B\u6848\u4F8B\uFF0C\u5E76\u8BA9\u5927\u7EB2\u66F4\u7A81\u51FA\u9012\u8FDB\u5173\u7CFB\u3002", className: "field-input mt-2 resize-y" })] })) : null, actionError ? (_jsx("p", { className: "mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200", children: actionError })) : null, _jsxs("div", { className: "mt-5 flex flex-col gap-3 sm:flex-row", children: [_jsx("button", { type: "button", disabled: isActing, onClick: () => void submitAction("approve"), className: "inline-flex h-11 items-center justify-center rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-ink-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60", children: isActing ? "提交中..." : "Approve and Continue" }), showModification ? (_jsx("button", { type: "button", disabled: isActing, onClick: () => void submitAction("modify"), className: "inline-flex h-11 items-center justify-center rounded-xl border border-amber-200/30 bg-amber-200/12 px-5 text-sm font-semibold text-amber-50 transition hover:bg-amber-200/18 disabled:cursor-not-allowed disabled:opacity-60", children: "Submit Changes" })) : (_jsx("button", { type: "button", disabled: isActing, onClick: () => setShowModification(true), className: "inline-flex h-11 items-center justify-center rounded-xl border border-white/12 bg-white/8 px-5 text-sm font-semibold text-white transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-60", children: "Request Changes" }))] })] })) : null, _jsx("div", { className: "grid gap-3 lg:grid-cols-2", children: steps.map((step, index) => (_jsx(AgentStepCard, { step: step, index: index }, step.id))) })] }));
}
function AgentStepCard({ step, index }) {
    const statusText = {
        waiting: "等待中",
        running: "运行中",
        done: "已完成",
    }[step.status];
    return (_jsx("article", { className: [
            "group rounded-xl border p-4 transition-all duration-500",
            step.status === "running"
                ? "border-cyan-300/40 bg-cyan-300/10 shadow-glow"
                : "border-white/10 bg-white/6",
            step.status === "done" ? "border-emerald-300/30 bg-emerald-300/8" : "",
        ].join(" "), children: _jsxs("div", { className: "flex items-start gap-4", children: [_jsx("div", { className: [
                        "grid size-9 shrink-0 place-items-center rounded-lg text-sm font-semibold transition",
                        step.status === "done"
                            ? "bg-emerald-300 text-ink-950"
                            : step.status === "running"
                                ? "animate-pulse bg-cyan-300 text-ink-950"
                                : "bg-white/10 text-slate-300",
                    ].join(" "), children: step.status === "done" ? "✓" : index + 1 }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsx("h2", { className: "font-medium text-white", children: step.name }), _jsx("span", { className: "rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-xs text-slate-300", children: statusText })] }), _jsx("p", { className: "mt-1 text-xs text-slate-500", children: step.id }), step.summary ? (_jsx("p", { className: "mt-3 animate-fade-in text-sm leading-6 text-slate-300", children: step.summary })) : (_jsx("div", { className: "mt-4 h-2 w-2/3 rounded-full bg-white/8" }))] })] }) }));
}
function ResultPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const auth = useAuth();
    const [task, setTask] = useState(null);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!id)
            return;
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
            const data = (await response.json());
            setTask(data.task);
        };
        void fetchResult().catch((caught) => {
            setError(caught instanceof Error ? caught.message : "获取结果失败。");
        });
    }, [auth, id, navigate]);
    const essay = useMemo(() => {
        if (task?.result)
            return task.result;
        return task?.agentResults.at(-1)?.output ?? "";
    }, [task]);
    const handleCopy = async () => {
        if (!essay)
            return;
        await navigator.clipboard.writeText(essay);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
    };
    return (_jsxs("section", { className: "flex flex-1 flex-col py-8 lg:py-10", children: [_jsxs("div", { className: "mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm text-slate-400", children: "Final essay" }), _jsx("h1", { className: "mt-2 text-3xl font-semibold text-white", children: "\u4F5C\u6587\u7EC8\u7A3F" }), _jsx("p", { className: "mt-2 max-w-2xl text-sm leading-6 text-slate-300", children: task?.topic ?? "正在读取写作结果..." })] }), _jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx("button", { type: "button", onClick: handleCopy, disabled: !essay, className: "rounded-xl border border-white/12 bg-white/8 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/12 disabled:opacity-50", children: copied ? "已复制" : "复制" }), _jsx("button", { type: "button", onClick: () => navigate("/"), className: "rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-cyan-200", children: "Rewrite" })] })] }), error ? (_jsx("p", { className: "mb-5 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200", children: error })) : null, _jsx("article", { className: "mx-auto w-full max-w-4xl rounded-2xl border border-white/12 bg-[#f8fafc] px-5 py-7 text-slate-950 shadow-panel sm:px-8 md:px-12 md:py-10", children: essay ? (_jsx("div", { className: "prose-essay", children: essayParagraphs(essay).map((paragraph, index) => (_jsx("p", { children: paragraph }, `${paragraph.slice(0, 16)}-${index}`))) })) : (_jsxs("div", { className: "space-y-3", children: [_jsx("div", { className: "h-4 w-2/3 animate-pulse rounded-full bg-slate-200" }), _jsx("div", { className: "h-4 w-full animate-pulse rounded-full bg-slate-200" }), _jsx("div", { className: "h-4 w-5/6 animate-pulse rounded-full bg-slate-200" })] })) })] }));
}
export default App;
function SettingsPage() {
    const auth = useAuth();
    const navigate = useNavigate();
    const [baseUrl, setBaseUrl] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [model, setModel] = useState("glm-5.1");
    const [savedConfig, setSavedConfig] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState(null);
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
                if (!res.ok)
                    return;
                const data = (await res.json());
                if (data.config) {
                    setSavedConfig(data.config);
                    setBaseUrl(data.config.baseUrl);
                    setModel(data.config.model);
                    // Don't fill apiKey — user must re-enter to update
                }
            }
            catch {
                // ignore
            }
        };
        void load();
    }, [auth, navigate]);
    const handleSave = async (e) => {
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
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const data = (await res.json());
            setSavedConfig(data.config);
            setApiKey("");
            setMessage({ type: "ok", text: "Configuration saved successfully!" });
        }
        catch (caught) {
            setMessage({
                type: "err",
                text: caught instanceof Error ? caught.message : "Save failed.",
            });
        }
        finally {
            setIsSaving(false);
        }
    };
    const handleTest = async () => {
        setTesting(true);
        setMessage(null);
        try {
            const testRes = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
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
            });
            if (testRes.ok) {
                setMessage({ type: "ok", text: "LLM connection test passed!" });
            }
            else {
                const body = await testRes.text();
                setMessage({
                    type: "err",
                    text: `Connection failed (${testRes.status}): ${body.slice(0, 120)}`,
                });
            }
        }
        catch (caught) {
            setMessage({
                type: "err",
                text: `Connection error: ${caught instanceof Error ? caught.message : "unknown"}`,
            });
        }
        finally {
            setTesting(false);
        }
    };
    return (_jsxs("section", { className: "flex flex-1 flex-col py-8 lg:py-10", children: [_jsxs("div", { className: "mb-8", children: [_jsx("p", { className: "text-sm text-slate-400", children: "Configuration" }), _jsx("h1", { className: "mt-2 text-3xl font-semibold text-white", children: "LLM Settings" }), _jsx("p", { className: "mt-2 max-w-2xl text-sm leading-6 text-slate-300", children: "Configure the OpenAI-compatible LLM API endpoint. The API key is stored server-side and never exposed to the browser after saving." })] }), _jsxs("div", { className: "w-full max-w-xl rounded-2xl border border-white/12 bg-ink-900/88 p-5 shadow-panel backdrop-blur md:p-7", children: [savedConfig ? (_jsxs("div", { className: "mb-6 rounded-xl border border-emerald-300/20 bg-emerald-300/8 px-4 py-3", children: [_jsxs("div", { className: "flex items-center gap-2 text-sm text-emerald-200", children: [_jsx("span", { className: "size-2 rounded-full bg-emerald-400" }), "Configured"] }), _jsxs("div", { className: "mt-2 space-y-1 text-xs text-slate-300", children: [_jsxs("p", { children: ["Base URL:", " ", _jsx("span", { className: "text-white", children: savedConfig.baseUrl })] }), _jsxs("p", { children: ["API Key:", " ", _jsx("span", { className: "font-mono text-white", children: savedConfig.apiKeyMasked })] }), _jsxs("p", { children: ["Model: ", _jsx("span", { className: "text-white", children: savedConfig.model })] }), _jsxs("p", { children: ["Last updated: ", savedConfig.updatedAt] })] })] })) : (_jsx("div", { className: "mb-6 rounded-xl border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-sm text-amber-200", children: "No LLM configured yet. Fill in the form below to get started." })), _jsxs("form", { onSubmit: handleSave, className: "space-y-5", children: [_jsxs("label", { className: "block", children: [_jsx("span", { className: "field-label", children: "Base URL" }), _jsx("input", { value: baseUrl, onChange: (e) => setBaseUrl(e.target.value), placeholder: "https://api.openrouter.ai or http://your-server:3001", className: "field-input mt-2" })] }), _jsxs("label", { className: "block", children: [_jsx("span", { className: "field-label", children: "API Key" }), _jsx("input", { type: "password", value: apiKey, onChange: (e) => setApiKey(e.target.value), placeholder: savedConfig ? "Enter new key to update" : "sk-xxx...", className: "field-input mt-2" })] }), _jsxs("label", { className: "block", children: [_jsx("span", { className: "field-label", children: "Model" }), _jsx("input", { value: model, onChange: (e) => setModel(e.target.value), placeholder: "e.g. glm-5.1, gpt-4o, deepseek-chat", className: "field-input mt-2" })] }), message ? (_jsx("div", { className: `rounded-lg border px-3 py-2 text-sm ${message.type === "ok" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-red-400/30 bg-red-500/10 text-red-200"}`, children: message.text })) : null, _jsxs("div", { className: "flex gap-3", children: [_jsx("button", { type: "submit", disabled: isSaving, className: "inline-flex h-11 items-center justify-center rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-ink-950 shadow-glow transition hover:bg-cyan-200 disabled:opacity-60", children: isSaving ? "Saving..." : "Save" }), _jsx("button", { type: "button", onClick: handleTest, disabled: testing || !baseUrl || !apiKey || !model, className: "inline-flex h-11 items-center justify-center rounded-xl border border-white/12 bg-white/8 px-5 text-sm font-medium text-white transition hover:bg-white/12 disabled:opacity-50", children: testing ? "Testing..." : "Test Connection" })] })] })] })] }));
}
//# sourceMappingURL=App.js.map