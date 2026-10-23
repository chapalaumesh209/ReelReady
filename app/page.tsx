"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Mic,
  Clapperboard,
  Upload,
  Globe2,
  Send,
  LoaderCircle,
  Copy,
  Download,
  CalendarDays,
  RotateCcw,
  Link2,
  AlertCircle,
  X,
  Volume2,
} from "lucide-react";
import { Logo, AutoTextarea, OutputEditor } from "@/components/studio";
import {
  platforms,
  platformNames,
  languages,
  MAX_VIDEO_BYTES,
  type Platform,
  type Plan,
  type Analysis,
  type Connections,
  type PublishJob,
} from "@/lib/workflow";
import {
  samples,
  type Language,
  type Script,
  type Kit,
  characterCount,
  xCount,
} from "@/lib/content";
import {
  loadMedia,
  storeMedia,
  metadata,
  normalizeVideo,
  exportDub,
} from "@/lib/browser-media";
type Details = {
  voice: string;
  brand: string;
  link: string;
  disclosure: string;
};
type Draft = {
  version: 2;
  id: string;
  step: number;
  input: string;
  scheduledLocal: string;
  timezone: string;
  platforms: Platform[];
  languages: Language[];
  script: Script;
  plan: Plan | null;
  planSignature: string;
  selected: number;
  token: string;
  analysis: Analysis | null;
  kits: Partial<Record<Language, Kit>>;
  kitLanguage: Language;
  details: Details;
  fileName: string;
  meta: { duration: number; width: number; height: number } | null;
  dubScript: string;
  variant: "original" | "english";
  timing: "schedule" | "now";
  job: PublishJob | null;
};
const key = "reelready.flow.v2";
function tomorrow() {
  const d = new Date(Date.now() + 86400000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function fresh(): Draft {
  return {
    version: 2,
    id: "",
    step: 0,
    input: "",
    scheduledLocal: "",
    timezone: "",
    platforms: ["instagram", "youtube"],
    languages: ["English"],
    script: "native",
    plan: null,
    planSignature: "",
    selected: 0,
    token: "",
    analysis: null,
    kits: {},
    kitLanguage: "English",
    details: { voice: "", brand: "", link: "", disclosure: "" },
    fileName: "",
    meta: null,
    dubScript: "",
    variant: "original",
    timing: "schedule",
    job: null,
  };
}
const steps = [
  { label: "Plan", icon: Mic },
  { label: "Record", icon: Clapperboard },
  { label: "Review", icon: Globe2 },
  { label: "Publish", icon: Send },
];
function signature(d: Draft) {
  return JSON.stringify([
    d.input,
    d.scheduledLocal,
    d.platforms,
    d.languages,
    d.script,
  ]);
}
function formatDate(iso: string) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Choose a time";
}
async function responseJSON<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok)
    throw new Error(
      data.error || "This step could not finish. Please try again.",
    );
  return data;
}
export default function Home() {
  const [draft, setDraft] = useState<Draft>(fresh),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [original, setOriginal] = useState<Blob | null>(null),
    [dubbed, setDubbed] = useState<Blob | null>(null),
    [preview, setPreview] = useState(""),
    [originalURL, setOriginalURL] = useState(""),
    [dubURL, setDubURL] = useState(""),
    [connections, setConnections] = useState<Connections>({
      configured: false,
      accounts: {},
    }),
    [connectionLoaded, setConnectionLoaded] = useState(false),
    [aiConfigured, setAIConfigured] = useState<boolean | null>(null),
    [revision, setRevision] = useState(""),
    [help, setHelp] = useState(false),
    [storageWarning, setStorageWarning] = useState(false),
    [newConfirm, setNewConfirm] = useState(false),
    [pickerAttempted, setPickerAttempted] = useState(false);
  const controller = useRef<AbortController | null>(null),
    operation = useRef(false),
    headingRef = useRef<HTMLHeadingElement>(null);
  const patch = (values: Partial<Draft>) =>
    setDraft((d) => ({ ...d, ...values }));
  async function refreshConnections() {
    try {
      const state = await responseJSON<Connections & { aiConfigured: boolean }>(
        await fetch("/api/connections"),
      );
      setConnections(state);
      setAIConfigured(state.aiConfigured);
      setConnectionLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection check failed.");
      setConnectionLoaded(true);
    }
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let restored = fresh();
      restored.id = crypto.randomUUID();
      restored.scheduledLocal = tomorrow();
      restored.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const saved = JSON.parse(raw);
          if (
            saved.version === 2 &&
            typeof saved.id === "string" &&
            Array.isArray(saved.platforms) &&
            Array.isArray(saved.languages) &&
            typeof saved.input === "string" &&
            Number.isInteger(saved.step) &&
            saved.step >= 0 &&
            saved.step <= 3
          )
            restored = { ...restored, ...saved };
        }
      } catch {
        setStorageWarning(true);
      }
      let video: Blob | null = null,
        dub: Blob | null = null;
      try {
        [video, dub] = await Promise.all([
          loadMedia("original"),
          loadMedia("dubbed"),
        ]);
      } catch {
        setStorageWarning(true);
      }
      if (!cancelled) {
        setDraft(restored);
        setOriginal(video);
        setDubbed(dub);
        setReady(true);
      }
    })();
    void refreshConnections();
    const handleFocus = () => {
      void refreshConnections();
    };
    window.addEventListener("focus", handleFocus);
    if (new URLSearchParams(location.search).has("connected")) {
      history.replaceState({}, "", location.pathname);
      setNotice(
        "Account connection returned. Checking which accounts are ready…",
      );
    }
    return () => {
      cancelled = true;
      controller.current?.abort();
      window.removeEventListener("focus", handleFocus);
    };
  }, []);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem(key, JSON.stringify(draft));
      } catch {
        setStorageWarning(true);
      }
  }, [draft, ready]);
  useEffect(() => {
    if (!original) {
      setOriginalURL("");
      return;
    }
    const u = URL.createObjectURL(original);
    setOriginalURL(u);
    return () => URL.revokeObjectURL(u);
  }, [original]);
  useEffect(() => {
    if (!dubbed) {
      setDubURL("");
      return;
    }
    const u = URL.createObjectURL(dubbed);
    setDubURL(u);
    return () => URL.revokeObjectURL(u);
  }, [dubbed]);
  useEffect(() => {
    setPreview(draft.variant === "english" && dubURL ? dubURL : originalURL);
  }, [draft.variant, originalURL, dubURL]);
  async function run(
    label: string,
    fn: (signal: AbortSignal) => Promise<void>,
  ) {
    if (operation.current) return;
    operation.current = true;
    const c = new AbortController();
    controller.current = c;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn(c.signal);
    } catch (e) {
      if (c.signal.aborted) setNotice("Cancelled. Your draft is safe.");
      else
        setError(
          e instanceof Error
            ? e.message
            : "This step could not finish. Please try again.",
        );
    } finally {
      operation.current = false;
      setBusy("");
      controller.current = null;
    }
  }
  async function post<T>(
    url: string,
    data: unknown,
    signal: AbortSignal,
  ): Promise<T> {
    return responseJSON<T>(
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal,
      }),
    );
  }
  function go(step: number) {
    patch({ step });
    setError("");
    setNotice("");
    requestAnimationFrame(() => headingRef.current?.focus());
  }
  function toggle<T extends string>(list: T[], value: T) {
    return list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
  }
  function planGenerate() {
    void run("Finding three reel ideas…", async (signal) => {
      if (draft.input.trim().length < 20)
        throw new Error(
          "Tell us a little more about the reel—at least 20 characters.",
        );
      if (!draft.platforms.length || !draft.languages.length)
        throw new Error("Choose at least one platform and one language.");
      const when = new Date(draft.scheduledLocal);
      if (!Number.isFinite(when.getTime()))
        throw new Error("Choose the date and time you want to publish.");
      if (
        original &&
        !window.confirm(
          "Generating a new plan clears the current recording, review and delivery from this browser. Continue?",
        )
      )
        return;
      const plan = await post<Plan>(
        "/api/plan",
        {
          input: draft.input,
          scheduledAt: when.toISOString(),
          timezone: draft.timezone,
          platforms: draft.platforms,
          languages: draft.languages,
          script: draft.script,
        },
        signal,
      );
      if (draft.token) void removeRemote(draft.token);
      setOriginal(null);
      setDubbed(null);
      await Promise.all([
        storeMedia("original", null),
        storeMedia("dubbed", null),
      ]).catch(() => setStorageWarning(true));
      patch({
        id: crypto.randomUUID(),
        plan,
        planSignature: signature(draft),
        selected: 0,
        token: "",
        analysis: null,
        kits: {},
        meta: null,
        fileName: "",
        job: null,
        dubScript: "",
        variant: "original",
      });
    });
  }
  async function removeRemote(token: string) {
    try {
      await responseJSON(
        await fetch("/api/video", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        }),
      );
    } catch {
      setNotice(
        "The remote analysis copy could not be removed yet. It expires automatically within 48 hours.",
      );
    }
  }
  async function acceptVideo(selectedFile: File) {
    if (busy) return;
    void run("Checking your recording…", async (signal) => {
      const file = normalizeVideo(selectedFile);
      if (!["video/mp4", "video/quicktime", "video/webm"].includes(file.type))
        throw new Error("Choose an MP4, MOV or WebM video.");
      if (file.size > MAX_VIDEO_BYTES)
        throw new Error("Keep the video under 80 MB for this version.");
      const meta = await metadata(file, signal);
      if (meta.duration > 180 || meta.duration < 1)
        throw new Error("Choose a reel between 1 second and 3 minutes long.");
      if (draft.token) void removeRemote(draft.token);
      setOriginal(file);
      setDubbed(null);
      patch({
        fileName: file.name,
        meta,
        token: "",
        analysis: null,
        kits: {},
        job: null,
        dubScript: "",
        variant: "original",
      });
      try {
        await storeMedia("original", file);
        await storeMedia("dubbed", null);
      } catch {
        setStorageWarning(true);
      }
      setNotice("Recording added. Continue to review when you’re ready.");
    });
  }
  async function ensureVideo(signal: AbortSignal) {
    if (draft.token) {
      try {
        const status = await responseJSON<{ state: string }>(
          await fetch(`/api/video?token=${encodeURIComponent(draft.token)}`, {
            signal,
          }),
        );
        if (status.state === "ACTIVE") return draft.token;
      } catch (e) {
        if (signal.aborted) throw e;
      }
    }
    if (!original) throw new Error("Upload your recording first.");
    setBusy("Uploading your recording for understanding…");
    const file = await responseJSON<{ token: string; state: string }>(
      await fetch("/api/video", {
        method: "POST",
        headers: {
          "Content-Type": original.type,
          "X-File-Size": String(original.size),
        },
        body: original,
        signal,
      }),
    );
    patch({ token: file.token });
    for (let n = 0; n < 40; n++) {
      if (file.state === "ACTIVE") return file.token;
      if (file.state === "FAILED")
        throw new Error(
          "This recording could not be processed. Try exporting it as MP4.",
        );
      setBusy("Understanding your recording…");
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 2000);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(new DOMException("Cancelled", "AbortError"));
          },
          { once: true },
        );
      });
      const state = await responseJSON<{ state: string }>(
        await fetch(`/api/video?token=${encodeURIComponent(file.token)}`, {
          signal,
        }),
      );
      file.state = state.state;
    }
    throw new Error(
      "The video is still processing. Try reviewing again in a moment.",
    );
  }
  async function makeKit(
    analysis: Analysis,
    language: Language,
    signal: AbortSignal,
  ): Promise<Kit> {
    const kit = await post<Kit>(
      "/api/generate",
      {
        mode: "after",
        input: `Actual recorded content: ${analysis.summary}\nApproved English voiceover: ${analysis.englishScript}`,
        language,
        script: draft.script,
        details: draft.details,
      },
      signal,
    );
    if (kit.clarification) throw new Error(kit.clarification);
    return kit;
  }
  function analyze() {
    void run("Preparing your video review…", async (signal) => {
      const token = await ensureVideo(signal);
      setBusy("Listening to your reel and drafting the English version…");
      const analysis = await post<Analysis>(
        "/api/review",
        {
          token,
          idea: JSON.stringify(draft.plan?.ideas[draft.selected]),
          revision,
          previous: draft.analysis,
          duration: draft.meta?.duration,
        },
        signal,
      );
      patch({ analysis, token, kits: {}, dubScript: "", variant: "original" });
      setDubbed(null);
      await storeMedia("dubbed", null).catch(() => setStorageWarning(true));
      setBusy("Writing your platform captions…");
      const kit = await makeKit(analysis, "English", signal);
      patch({ kits: { English: kit }, kitLanguage: "English", step: 2 });
      setRevision("");
      requestAnimationFrame(() => headingRef.current?.focus());
    });
  }
  function generateKit(language: Language) {
    void run(`Writing in ${language}…`, async (signal) => {
      if (!draft.analysis) throw new Error("Review the recording first.");
      const kit = await makeKit(draft.analysis, language, signal);
      setDraft((d) => ({
        ...d,
        kits: { ...d.kits, [language]: kit },
        kitLanguage: language,
      }));
    });
  }
  function createDub() {
    void run("Creating your English voiceover…", async (signal) => {
      if (!original || !draft.analysis?.englishScript || !draft.meta)
        throw new Error(
          "Review the recording and approve an English script first.",
        );
      const response = await fetch("/api/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: draft.analysis.englishScript }),
        signal,
      });
      if (!response.ok) {
        await responseJSON(response);
        return;
      }
      const audio = await response.blob();
      const result = await exportDub(
        original,
        audio,
        draft.meta.duration,
        setBusy,
        signal,
      );
      if (result.size > MAX_VIDEO_BYTES)
        throw new Error(
          "The English export is over 80 MB. Use a smaller recording and try again.",
        );
      setDubbed(result);
      patch({ dubScript: draft.analysis.englishScript, variant: "english" });
      try {
        await storeMedia("dubbed", result);
      } catch {
        setStorageWarning(true);
      }
      setNotice(
        "English video ready. Watch it and check the pronunciation before publishing.",
      );
    });
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied to clipboard.");
    } catch {
      setError(
        "Clipboard access is blocked. Select the text and copy it using your browser.",
      );
    }
  }
  function connect() {
    void run("Opening account connection…", async (signal) => {
      const { url } = await post<{ url: string }>(
        "/api/connections",
        { action: "connect" },
        signal,
      );
      location.assign(url);
    });
  }
  function disconnect(platform: Platform) {
    void run("Disconnecting account…", async (signal) => {
      await post(
        "/api/connections",
        { action: "disconnect", platform },
        signal,
      );
      await refreshConnections();
    });
  }
  function deliveryStatus() {
    void run("Checking delivery…", async (signal) => {
      if (!draft.job) return;
      const job = await responseJSON<PublishJob>(
        await fetch(
          `/api/publish?token=${encodeURIComponent(draft.job.token)}`,
          { signal },
        ),
      );
      patch({ job });
    });
  }
  const activeKit = draft.kits[draft.kitLanguage],
    idea = draft.plan?.ideas[draft.selected],
    dubValid = !!dubbed && draft.dubScript === draft.analysis?.englishScript;
  const finalVideo =
    draft.variant === "english" && dubValid ? dubbed : original;
  const allConnected = draft.platforms.every(
    (p) => connections.accounts[p]?.connected,
  );
  const finalTexts = Object.fromEntries(
    activeKit?.outputs.map((o) => [o.id, o.text]) || [],
  );
  const textInvalid = !!activeKit?.outputs.some(
    (o) =>
      (o.id === "instagram" &&
        draft.platforms.includes("instagram") &&
        characterCount(o.text) > 2200) ||
      (o.id === "youtubeTitle" &&
        draft.platforms.includes("youtube") &&
        characterCount(o.text) > 100) ||
      (o.id === "x" && draft.platforms.includes("x") && xCount(o.text) > 280),
  );
  function publish() {
    void run(
      draft.timing === "schedule"
        ? "Scheduling your reel…"
        : "Sending your reel…",
      async (signal) => {
        if (!finalVideo || !draft.meta || !activeKit)
          throw new Error("Complete the video and caption review first.");
        if (draft.variant === "english" && !dubValid)
          throw new Error(
            "The English script changed. Create a new English video before publishing.",
          );
        const payload = {
          draftId: draft.id,
          platforms: draft.platforms,
          scheduledAt:
            draft.timing === "schedule"
              ? new Date(draft.scheduledLocal).toISOString()
              : null,
          instagram: finalTexts.instagram || "",
          youtubeTitle: finalTexts.youtubeTitle || "",
          youtubeDescription: finalTexts.youtubeDescription || "",
          x: finalTexts.x || "",
          language: draft.kitLanguage,
          dubbed: draft.variant === "english",
          size: finalVideo.size,
          ...draft.meta,
        };
        const prepared = await post<{ token: string; tracking: string }>(
          "/api/publish",
          payload,
          signal,
        );
        // Persist a recovery handle before the upload starts, so a lost response never implies it failed.
        const pending: PublishJob = {
          token: prepared.tracking,
          deliveries: draft.platforms.map((platform) => ({
            platform,
            state: "processing",
          })),
          scheduledAt: payload.scheduledAt,
          done: false,
        };
        patch({ job: pending });
        try {
          const job = await responseJSON<PublishJob>(
            await fetch("/api/publish", {
              method: "POST",
              headers: {
                "Content-Type": "application/x-reelready-video",
                "X-Video-Type": finalVideo.type,
                "X-File-Size": String(finalVideo.size),
              },
              body: new Blob([
                JSON.stringify({ token: prepared.token }) + "\n",
                finalVideo,
              ]),
              signal,
            }),
          );
          patch({ job });
          setNotice(
            job.deliveries.some((d) => d.state === "scheduled")
              ? "Your reel has been accepted for scheduling."
              : "Your reel has been sent. Check each platform’s delivery below.",
          );
        } catch (e) {
          throw new Error(
            `${e instanceof Error ? e.message : "The upload response was lost."} Check delivery before attempting to send again.`,
          );
        }
      },
    );
  }
  function reset() {
    void run("Clearing this browser’s reel…", async () => {
      if (draft.token) await removeRemote(draft.token);
      await Promise.all([
        storeMedia("original", null),
        storeMedia("dubbed", null),
      ]).catch(() => setStorageWarning(true));
      setOriginal(null);
      setDubbed(null);
      const next = fresh();
      next.id = crypto.randomUUID();
      next.scheduledLocal = tomorrow();
      next.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      next.details = draft.details;
      setDraft(next);
      setNewConfirm(false);
      setRevision("");
      setNotice(
        "A fresh reel is ready. Your social connections and creator details are kept.",
      );
    });
  }
  const canNavigate = (i: number) =>
    i === 0 ||
    (i === 1 &&
      !!draft.plan &&
      (!!original || signature(draft) === draft.planSignature)) ||
    (i === 2 && !!draft.analysis) ||
    (i === 3 && !!draft.analysis && !!activeKit);
  return (
    <div className="studio-shell">
      <a className="skip-link" href="#workspace">
        Skip to reel workspace
      </a>
      <header className="app-header">
        <a href="/" className="brand">
          <Logo />
          <span>
            reelready<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="header-actions">
          <span className="open-label">No sign-up. Just create.</span>
          <button
            className="quiet"
            onClick={() => setHelp(!help)}
            aria-expanded={help}
          >
            How it works
          </button>
        </div>
      </header>
      <main id="workspace">
        <div className="intro">
          <h1>
            From your voice
            <br className="mobile-break" /> to your next reel.
          </h1>
          <p>Plan it. Record it. Make it travel.</p>
        </div>
        {help && (
          <aside className="help-panel">
            <button
              className="quiet close-help"
              aria-label="Close help"
              onClick={() => setHelp(false)}
            >
              <X size={18} />
            </button>
            <h2>A little voice goes a long way.</h2>
            <ol>
              <li>
                Describe your reel with Wispr Flow. Choose your time, platforms
                and languages.
              </li>
              <li>
                Pick an idea, film it, then upload or paste the video file.
              </li>
              <li>
                Review the English script, create an English voiceover video,
                and edit your captions.
              </li>
              <li>
                Connect your social accounts, then publish or schedule the
                approved video.
              </li>
            </ol>
            <p>
              Wispr Flow runs separately. Click a text field and use your Flow
              shortcut in any supported input language. ReelReady provides
              English, Telugu and Hindi output. Your video goes to Google for
              understanding (analysis copies expire within 48 hours) and to
              Upload-Post only when you publish. The English version uses a
              generated voice; visuals stay the same. Drafts stay in this
              browser.
            </p>
          </aside>
        )}
        <nav className="stepper" aria-label="Reel creation steps">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <button
                key={s.label}
                disabled={!ready || !!busy || !canNavigate(i)}
                aria-current={draft.step === i ? "step" : undefined}
                className={
                  draft.step === i
                    ? "current"
                    : draft.step > i
                      ? "complete"
                      : ""
                }
                onClick={() => go(i)}
              >
                <span className="step-symbol">
                  {draft.step > i ? <Check size={17} /> : <Icon size={17} />}
                </span>
                <span>{s.label}</span>
                <span className="step-number">{i + 1}</span>
              </button>
            );
          })}
        </nav>
        <div className="messages">
          {error && (
            <div className="message error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button
                className="quiet"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="message notice" role="status">
              <Check size={17} />
              <span>{notice}</span>
            </div>
          )}
          {storageWarning && (
            <p className="hint warning">
              Browser storage is unavailable or full. Keep this tab open and
              download your work before leaving.
            </p>
          )}
          {aiConfigured === false && (
            <p className="message error">
              AI generation is not connected on the server yet. Your draft will
              be kept.
            </p>
          )}
        </div>
        <fieldset
          className="flow-fields"
          disabled={!ready || !connectionLoaded || !!busy}
        >
          <legend className="sr-only">Create your reel</legend>
          {draft.step === 0 && (
            <section className="workspace-panel">
              <div className="panel-heading">
                <div>
                  <h2 ref={headingRef} tabIndex={-1}>
                    What are we making?
                  </h2>
                  <p>
                    A rough idea is all you need. Speak in the language you
                    think in.
                  </p>
                </div>
                <Mic className="heading-icon" size={25} />
              </div>
              <label className="field-label" htmlFor="idea">
                Your reel idea
              </label>
              <div className="idea-input">
                <AutoTextarea
                  id="idea"
                  onSubmit={planGenerate}
                  value={draft.input}
                  onChange={(input) => patch({ input })}
                  placeholder="A quick breakfast reel for busy mornings. Show a mango yogurt bowl, keep it friendly, and ask viewers what fruit they’d add…"
                  rows={4}
                />
                <div className="input-footer">
                  <span>
                    <Mic size={14} /> Use your Flow shortcut · Enter to generate
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => patch({ input: samples.before })}
                  >
                    Try an example
                  </button>
                </div>
              </div>
              <div className="schedule-row">
                <div>
                  <label className="field-label" htmlFor="schedule">
                    When do you want to publish?
                  </label>
                  <input
                    id="schedule"
                    type="datetime-local"
                    value={draft.scheduledLocal}
                    onChange={(e) => patch({ scheduledLocal: e.target.value })}
                  />
                  <p className="hint">
                    Your time zone: {draft.timezone || "detecting…"}
                  </p>
                </div>
                <div>
                  <label className="field-label" htmlFor="script">
                    Writing style
                  </label>
                  <select
                    id="script"
                    value={draft.script}
                    onChange={(e) =>
                      patch({ script: e.target.value as Script })
                    }
                  >
                    <option value="native">Native script</option>
                    <option value="roman">Roman script (Telugu / Hindi)</option>
                  </select>
                  <p className="hint">
                    Roman keeps your language, written in Latin letters.
                  </p>
                </div>
              </div>
              <div className="choice-row">
                <fieldset>
                  <legend className="field-label">Where will it go?</legend>
                  <div className="pills">
                    {platforms.map((p) => (
                      <label
                        className={`choice ${draft.platforms.includes(p) ? "selected" : ""}`}
                        key={p}
                      >
                        <input
                          type="checkbox"
                          checked={draft.platforms.includes(p)}
                          onChange={() =>
                            patch({ platforms: toggle(draft.platforms, p) })
                          }
                        />
                        {platformNames[p]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="field-label">Caption languages</legend>
                  <div className="pills">
                    {languages.map((l) => (
                      <label
                        className={`choice ${draft.languages.includes(l) ? "selected" : ""}`}
                        key={l}
                      >
                        <input
                          type="checkbox"
                          checked={draft.languages.includes(l)}
                          onChange={() =>
                            patch({ languages: toggle(draft.languages, l) })
                          }
                        />
                        {l}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <details className="creator-details">
                <summary>
                  Add my voice & brand details <span>Optional</span>
                </summary>
                <div className="details-body">
                  <label className="field-label" htmlFor="voice">
                    Paste a few past captions
                  </label>
                  <AutoTextarea
                    id="voice"
                    value={draft.details.voice}
                    onChange={(voice) =>
                      patch({ details: { ...draft.details, voice } })
                    }
                    maxLength={3000}
                    placeholder="Help the captions sound like you."
                  />
                  <div className="schedule-row">
                    <div>
                      <label className="field-label" htmlFor="brand">
                        Creator or brand name
                      </label>
                      <input
                        id="brand"
                        value={draft.details.brand}
                        maxLength={150}
                        onChange={(e) =>
                          patch({
                            details: {
                              ...draft.details,
                              brand: e.target.value,
                            },
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="link">
                        Link
                      </label>
                      <input
                        id="link"
                        type="url"
                        value={draft.details.link}
                        maxLength={500}
                        placeholder="https://…"
                        onChange={(e) =>
                          patch({
                            details: { ...draft.details, link: e.target.value },
                          })
                        }
                      />
                    </div>
                  </div>
                  <label className="field-label" htmlFor="disclosure">
                    CTA or partnership disclosure
                  </label>
                  <input
                    id="disclosure"
                    value={draft.details.disclosure}
                    maxLength={500}
                    onChange={(e) =>
                      patch({
                        details: {
                          ...draft.details,
                          disclosure: e.target.value,
                        },
                      })
                    }
                    placeholder="Follow for more · #ad, if applicable"
                  />
                </div>
              </details>
              <div className="action-row">
                <span className="hint">
                  Three ideas. One reel. Your choice.
                </span>
                <button className="primary" onClick={planGenerate}>
                  {draft.plan ? "Regenerate ideas" : "Generate reel ideas"}
                  <ArrowRight size={17} />
                </button>
              </div>
              {draft.plan && (
                <div className="plan-results">
                  <div className="section-heading">
                    <h3>Pick your starting point</h3>
                    <span className="hint">Timing is an estimate</span>
                  </div>
                  <div
                    className="idea-options"
                    role="radiogroup"
                    aria-label="Choose a reel idea"
                  >
                    {draft.plan.ideas.map((item, i) => (
                      <label
                        className={`idea-option ${draft.selected === i ? "chosen" : ""}`}
                        key={i}
                      >
                        <input
                          type="radio"
                          name="chosen-idea"
                          checked={draft.selected === i}
                          disabled={!!original}
                          onChange={() => patch({ selected: i })}
                        />
                        <div>
                          <h4>{item.title}</h4>
                          <p>{item.hook}</p>
                          <span>
                            {item.durationSeconds}s reel · about{" "}
                            {item.preparationMinutes} min prep
                          </span>
                        </div>
                        {draft.selected === i && <Check size={19} />}
                      </label>
                    ))}
                  </div>
                  {idea && (
                    <div className="recording-plan">
                      <div>
                        <h4>Your outline</h4>
                        <ol>
                          {idea.outline.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                      </div>
                      <div>
                        <h4>Shots to get</h4>
                        <ul className="shot-list">
                          {idea.shots.map((s, i) => (
                            <li key={i}>
                              <Check size={13} />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                  <div className="schedule-note">
                    <CalendarDays size={20} />
                    <div>
                      <strong>
                        Record by {formatDate(draft.plan.recordBy)}
                      </strong>
                      <p>{draft.plan.schedulingNote}</p>
                    </div>
                  </div>
                  {signature(draft) !== draft.planSignature && (
                    <p className="hint warning">
                      The topic, date or destinations changed. Regenerate your
                      ideas before continuing.
                    </p>
                  )}
                  <div className="action-row end">
                    <button
                      className="primary"
                      disabled={signature(draft) !== draft.planSignature}
                      onClick={() => go(1)}
                    >
                      Use this plan & record
                      <ArrowRight size={17} />
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
          {draft.step === 1 && (
            <section className="workspace-panel">
              <div className="panel-heading">
                <div>
                  <h2 ref={headingRef} tabIndex={-1}>
                    Make it yours. Hit record.
                  </h2>
                  <p>Follow your plan, then bring the recording back here.</p>
                </div>
                <Clapperboard size={25} className="heading-icon" />
              </div>
              {idea && (
                <div className="selected-plan">
                  <h3>{idea.title}</h3>
                  <blockquote>{idea.hook}</blockquote>
                  <div className="recording-plan">
                    <div>
                      <h4>Outline</h4>
                      <ol>
                        {idea.outline.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <h4>Shot checklist</h4>
                      {idea.shots.map((s, i) => (
                        <label key={i} className="shot-check">
                          <input type="checkbox" />
                          {s}
                        </label>
                      ))}
                    </div>
                  </div>
                  <button
                    className="quiet"
                    onClick={() =>
                      void copy(
                        `${idea.title}\n${idea.hook}\n${idea.outline.join("\n")}\n${idea.shots.join("\n")}`,
                      )
                    }
                  >
                    <Copy size={15} />
                    Copy recording plan
                  </button>
                </div>
              )}
              <div
                className="upload-zone"
                tabIndex={0}
                aria-label="Drop or paste a video file"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) void acceptVideo(file);
                }}
                onPaste={(e) => {
                  const file = Array.from(e.clipboardData.files).find((f) =>
                    f.type.startsWith("video/"),
                  );
                  if (file) {
                    e.preventDefault();
                    void acceptVideo(file);
                  } else
                    setNotice(
                      "Paste a copied video file, or choose Upload video. Web links are not video files.",
                    );
                }}
              >
                <Upload size={25} />
                <h3>
                  {original
                    ? "Your recording is here"
                    : "Your reel, ready for its next step"}
                </h3>
                <p>
                  Drop a video, paste a copied video file, or choose one below.
                </p>
                <label className="field-label" htmlFor="recording-file">
                  {original ? "Replace recording" : "Upload video"}
                </label>
                <input
                  id="recording-file"
                  className="native-file-input"
                  type="file"
                  aria-label="Choose recording"
                  aria-describedby="upload-file-help"
                  accept=".mp4,.m4v,.mov,.webm,video/mp4,video/quicktime,video/webm"
                  onClick={(e) => {
                    e.currentTarget.value = "";
                    setPickerAttempted(true);
                  }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setPickerAttempted(false);
                      void acceptVideo(f);
                    }
                  }}
                />
                <p
                  id="upload-file-help"
                  className="hint"
                  role={pickerAttempted ? "status" : undefined}
                >
                  {pickerAttempted
                    ? "If no file picker appears in this browser, drag your video into this area or open this page in Chrome or Safari."
                    : "Choose a video file from your device."}
                </p>
                {pickerAttempted && (
                  <button
                    className="quiet"
                    type="button"
                    onClick={() => void copy(location.href)}
                  >
                    <Copy size={14} />
                    Copy site link
                  </button>
                )}
                <span className="hint">
                  MP4, MOV or WebM · up to 80 MB · up to 3 minutes
                </span>
              </div>
              {original && (
                <div className="video-block">
                  <video
                    src={originalURL || undefined}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label="Original recording preview"
                  />
                  <div className="media-meta">
                    <strong>{draft.fileName}</strong>
                    <span>
                      {Math.round(draft.meta?.duration || 0)}s ·{" "}
                      {draft.meta?.width} × {draft.meta?.height} ·{" "}
                      {(original.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                </div>
              )}
              <p className="privacy-note">
                Continue sends the recording to Google to understand its speech
                and visuals. Your browser keeps the original; the analysis copy
                expires within 48 hours.
              </p>
              <div className="action-row">
                <button className="quiet" onClick={() => go(0)}>
                  <ArrowLeft size={16} />
                  Back to plan
                </button>
                <button
                  className="primary"
                  disabled={!original}
                  onClick={analyze}
                >
                  Review my recording
                  <ArrowRight size={17} />
                </button>
              </div>
            </section>
          )}
          {draft.step === 2 && (
            <section className="workspace-panel">
              <div className="panel-heading">
                <div>
                  <h2 ref={headingRef} tabIndex={-1}>
                    Same story. A wider audience.
                  </h2>
                  <p>
                    Review the words, then make your English video and platform
                    captions.
                  </p>
                </div>
                <Globe2 size={25} className="heading-icon" />
              </div>
              <div className="review-layout">
                <div className="preview-column">
                  {preview ? (
                    <video
                      key={preview}
                      src={preview}
                      controls
                      playsInline
                      aria-label="Selected video preview"
                    />
                  ) : (
                    <p className="empty-media">
                      The local recording is missing. Go back and upload it
                      again.
                    </p>
                  )}
                  <div className="segmented" aria-label="Video version">
                    <button
                      aria-pressed={draft.variant === "original"}
                      onClick={() => patch({ variant: "original" })}
                    >
                      Original
                    </button>
                    <button
                      aria-pressed={draft.variant === "english"}
                      disabled={!dubValid}
                      onClick={() => patch({ variant: "english" })}
                    >
                      English voiceover
                    </button>
                  </div>
                  {preview && (
                    <a
                      className="download-link"
                      href={preview}
                      download={
                        draft.variant === "english"
                          ? "reelready-english.mp4"
                          : draft.fileName
                      }
                    >
                      <Download size={15} />
                      Download{" "}
                      {draft.variant === "english"
                        ? "English video"
                        : "original"}
                    </a>
                  )}
                  <p className="hint">
                    {draft.analysis?.sourceLanguage} source ·{" "}
                    {Math.round(draft.meta?.duration || 0)}s
                  </p>
                </div>
                <div className="script-column">
                  <label className="field-label" htmlFor="english-script">
                    English voiceover script
                  </label>
                  <AutoTextarea
                    id="english-script"
                    value={draft.analysis?.englishScript || ""}
                    onChange={(englishScript) =>
                      draft.analysis &&
                      patch({
                        analysis: { ...draft.analysis, englishScript },
                        variant: "original",
                      })
                    }
                    maxLength={3000}
                  />
                  <p className="hint">{draft.analysis?.audioNote}</p>
                  <button
                    className="secondary"
                    onClick={createDub}
                    disabled={!original || !draft.analysis?.englishScript}
                  >
                    <Volume2 size={16} />
                    {dubValid
                      ? "Recreate English video"
                      : "Create English video"}
                  </button>
                  <p className="hint">
                    A generated English voice replaces all original audio. Video
                    visuals stay the same. First use loads 31 MB of video tools.
                  </p>
                  <details>
                    <summary>Original transcript & observed content</summary>
                    <p className="transcript">
                      {draft.analysis?.transcript || "No speech detected."}
                    </p>
                    <p>{draft.analysis?.summary}</p>
                  </details>
                </div>
              </div>
              <div className="revision-box">
                <label className="field-label" htmlFor="revision">
                  Want to change the wording?
                </label>
                <AutoTextarea
                  id="revision"
                  onSubmit={() => {
                    if (revision.trim()) analyze();
                  }}
                  value={revision}
                  onChange={setRevision}
                  maxLength={3000}
                  placeholder="Use Wispr Flow in any language. For example: make the English voiceover more casual and shorten the opening."
                  rows={2}
                />
                <div className="action-row">
                  <p className="hint">
                    Updates the English script and captions. Visual edits need
                    your video editor.
                  </p>
                  <button
                    className="secondary"
                    disabled={!revision.trim()}
                    onClick={analyze}
                  >
                    Apply my changes
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
              <div className="section-heading">
                <h3>Your publishing kit</h3>
                <button
                  className="quiet"
                  disabled={!activeKit}
                  onClick={() =>
                    void copy(
                      activeKit!.outputs
                        .map((o) => `${o.title}\n${o.text}`)
                        .join("\n\n"),
                    )
                  }
                >
                  <Copy size={15} />
                  Copy all
                </button>
              </div>
              <div className="kit-controls">
                <div>
                  <label className="field-label" htmlFor="kit-language">
                    Caption language to publish
                  </label>
                  <select
                    id="kit-language"
                    value={draft.kitLanguage}
                    onChange={(e) =>
                      patch({ kitLanguage: e.target.value as Language })
                    }
                  >
                    {Array.from(
                      new Set<Language>(["English", ...draft.languages]),
                    ).map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </div>
                <button
                  className="secondary"
                  onClick={() => generateKit(draft.kitLanguage)}
                >
                  {activeKit ? "Regenerate captions" : "Generate captions"}
                </button>
                <span className="hint">
                  {draft.script === "roman" ? "Roman" : "Native"} script · One
                  language per publish
                </span>
              </div>
              {activeKit ? (
                <OutputEditor
                  kit={activeKit}
                  onCopy={(text) => void copy(text)}
                  onChange={(id, text) =>
                    setDraft((d) => ({
                      ...d,
                      kits: {
                        ...d.kits,
                        [d.kitLanguage]: {
                          ...d.kits[d.kitLanguage]!,
                          outputs: d.kits[d.kitLanguage]!.outputs.map((o) =>
                            o.id === id ? { ...o, text } : o,
                          ),
                        },
                      },
                    }))
                  }
                />
              ) : (
                <p className="empty-kit">
                  Generate the {draft.kitLanguage} kit to review these captions.
                </p>
              )}
              <div className="action-row">
                <button className="quiet" onClick={() => go(1)}>
                  <ArrowLeft size={16} />
                  Back to recording
                </button>
                <button
                  className="primary"
                  disabled={!activeKit || !original || textInvalid}
                  onClick={() => go(3)}
                >
                  Review & publish
                  <ArrowRight size={17} />
                </button>
              </div>
            </section>
          )}
          {draft.step === 3 && (
            <section className="workspace-panel">
              <div className="panel-heading">
                <div>
                  <h2 ref={headingRef} tabIndex={-1}>
                    One reel. Ready to go.
                  </h2>
                  <p>
                    Check your destinations and time. You’re in control of the
                    final send.
                  </p>
                </div>
                <Send size={25} className="heading-icon" />
              </div>
              <div className="publish-summary">
                <div>
                  {preview && (
                    <video
                      src={preview}
                      controls
                      playsInline
                      aria-label="Final video preview"
                    />
                  )}
                </div>
                <div>
                  <h3>{idea?.title || "Your reel"}</h3>
                  <p>
                    {draft.variant === "english"
                      ? "English generated voiceover"
                      : "Original audio"}{" "}
                    · {draft.kitLanguage} captions
                  </p>
                  <p>
                    {draft.platforms.map((p) => platformNames[p]).join(" · ")}
                  </p>
                  <button className="quiet" onClick={() => go(2)}>
                    Edit video & captions
                    <ArrowLeft size={15} />
                  </button>
                </div>
              </div>
              <div className="section-heading">
                <h3>Your social accounts</h3>
                <button
                  className="quiet"
                  onClick={() =>
                    void run("Checking connections…", async () => {
                      await refreshConnections();
                    })
                  }
                >
                  Refresh connections
                </button>
              </div>
              <p className="hint">
                No ReelReady account needed. Authorize your own social accounts
                once in this browser.
              </p>
              <div className="account-list">
                {platforms.map((p) => (
                  <div className="account-row" key={p}>
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.platforms.includes(p)}
                        disabled={!!draft.job}
                        onChange={() =>
                          patch({ platforms: toggle(draft.platforms, p) })
                        }
                      />
                      <strong>{platformNames[p]}</strong>
                    </label>
                    <span
                      className={
                        connections.accounts[p]?.connected
                          ? "connected"
                          : "hint"
                      }
                    >
                      {connections.accounts[p]?.connected
                        ? connections.accounts[p]?.name
                        : connections.accounts[p]?.reauth
                          ? "Reconnect required"
                          : "Not connected"}
                    </span>
                    {connections.accounts[p] && (
                      <button
                        className="text-button"
                        onClick={() => disconnect(p)}
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {!connections.configured && connectionLoaded && (
                <p className="message error">
                  Social publishing is awaiting the site’s Upload-Post
                  connection. You can still download your video and copy the
                  captions.
                </p>
              )}
              <button
                className="secondary"
                disabled={!connections.configured}
                onClick={connect}
              >
                <Link2 size={16} />
                Connect or manage accounts
              </button>
              <div className="publish-timing">
                <h3>When should it go live?</h3>
                <div className="pills">
                  <label
                    className={`choice ${draft.timing === "schedule" ? "selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="publish-time"
                      disabled={!!draft.job}
                      checked={draft.timing === "schedule"}
                      onChange={() => patch({ timing: "schedule" })}
                    />
                    Schedule it
                  </label>
                  <label
                    className={`choice ${draft.timing === "now" ? "selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="publish-time"
                      disabled={!!draft.job}
                      checked={draft.timing === "now"}
                      onChange={() => patch({ timing: "now" })}
                    />
                    Publish now
                  </label>
                </div>
                {draft.timing === "schedule" && (
                  <>
                    <label className="field-label" htmlFor="publish-date">
                      Publish date and time
                    </label>
                    <input
                      type="datetime-local"
                      id="publish-date"
                      disabled={!!draft.job}
                      value={draft.scheduledLocal}
                      onChange={(e) =>
                        patch({ scheduledLocal: e.target.value })
                      }
                    />
                    <p className="hint">
                      {draft.timezone} · {formatDate(draft.scheduledLocal)}
                    </p>
                  </>
                )}
              </div>
              <details className="final-captions">
                <summary>Check the exact text going to each platform</summary>
                {activeKit?.outputs
                  .filter((o) =>
                    o.id.startsWith("youtube")
                      ? draft.platforms.includes("youtube")
                      : draft.platforms.includes(o.id as Platform),
                  )
                  .map((o) => (
                    <div key={o.id}>
                      <h4>{o.title}</h4>
                      <p>{o.text}</p>
                    </div>
                  ))}
              </details>
              <p className="privacy-note">
                This sends the selected video and captions to the checked social
                accounts through Upload-Post. YouTube posts are public.
                Platforms may need processing time. Scheduling uses the time
                above, not a prediction of reach.
              </p>
              {draft.job && (
                <div className="delivery-panel">
                  <div className="section-heading">
                    <h3>Delivery status</h3>
                    <button className="quiet" onClick={deliveryStatus}>
                      Check delivery
                    </button>
                  </div>
                  {draft.job.deliveries.map((d) => (
                    <div className="delivery-row" key={d.platform}>
                      <strong>
                        {platformNames[d.platform as Platform] || d.platform}
                      </strong>
                      <span className={`delivery-state ${d.state}`}>
                        {d.state === "processing"
                          ? "Processing"
                          : d.state === "scheduled"
                            ? "Scheduled"
                            : d.state === "published"
                              ? "Published"
                              : d.state === "skipped"
                                ? "Not sent"
                                : "Failed"}
                      </span>
                      {d.message && <p>{d.message}</p>}
                      {d.url && (
                        <a href={d.url} target="_blank" rel="noreferrer">
                          View post
                          <ArrowRight size={14} />
                        </a>
                      )}
                    </div>
                  ))}
                  {draft.job.scheduledAt && (
                    <p className="hint">
                      Scheduled for {formatDate(draft.job.scheduledAt)}. Refresh
                      delivery after that time to confirm publication.
                    </p>
                  )}
                  <p className="hint">
                    The receipt is saved in this browser. Avoid sending again
                    while delivery is processing.
                  </p>
                </div>
              )}
              <div className="action-row">
                <button className="quiet" onClick={() => go(2)}>
                  <ArrowLeft size={16} />
                  Back to review
                </button>
                <button
                  className="primary"
                  disabled={
                    !allConnected ||
                    !draft.platforms.length ||
                    !finalVideo ||
                    !activeKit ||
                    textInvalid ||
                    !!draft.job
                  }
                  onClick={publish}
                >
                  {draft.timing === "schedule"
                    ? "Schedule on selected platforms"
                    : "Publish on selected platforms"}
                  <Send size={16} />
                </button>
              </div>
            </section>
          )}
        </fieldset>
        {busy && (
          <div className="busy-bar" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={18} />
            <span>{busy}</span>
            {!busy.includes("Scheduling") && !busy.includes("Sending") && (
              <button
                className="quiet"
                onClick={() => controller.current?.abort()}
              >
                Cancel
              </button>
            )}
          </div>
        )}
        <div className="bottom-row">
          <span>
            <Mic size={14} />
            Made for Wispr Flow. Open to everyone.
          </span>
          {ready && (
            <button
              className="quiet"
              disabled={!!busy}
              onClick={() => setNewConfirm(!newConfirm)}
            >
              <RotateCcw size={14} />
              Start a new reel
            </button>
          )}
        </div>
        {newConfirm && (
          <div className="new-confirm">
            <p>
              Clear this reel from the browser? Download your video first.
              Already scheduled or published posts are kept on their platforms.
            </p>
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() => setNewConfirm(false)}
            >
              Keep this reel
            </button>
            <button className="danger" disabled={!!busy} onClick={reset}>
              Clear & start new
            </button>
          </div>
        )}
      </main>
      <footer>
        Less admin. More creating.
        <span>Ideas are yours. The final say is too.</span>
      </footer>
    </div>
  );
}
