"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clapperboard,
  Copy,
  Globe2,
  HelpCircle,
  Lightbulb,
  LoaderCircle,
  Mic,
  Plus,
  RotateCcw,
  WandSparkles,
  X,
  AlertCircle,
  ArrowUpRight,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import {
  characterCount,
  hashtagCount,
  xCount,
  samples,
  type Kit,
  type Language,
  type Mode,
  type Script,
} from "@/lib/content";

type Details = {
  voice: string;
  brand: string;
  link: string;
  disclosure: string;
};
type Draft = { input: string; kit: Kit | null };
const emptyDraft = (): Draft => ({ input: "", kit: null });
const emptyDetails: Details = {
  voice: "",
  brand: "",
  link: "",
  disclosure: "",
};
const storageKey = "reelready.studio.v1";

function Logo({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? "wave-mark small" : "wave-mark"}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <rect
        width="48"
        height="48"
        rx="14"
        fill="currentColor"
        className="logo-ground"
      />
      <g stroke="currentColor" strokeWidth="3.6" strokeLinecap="round">
        <path d="M10.5 20v8M17.5 13v22M24.5 17v14" />
      </g>
      <path d="m32 17 9 7-9 7V17Z" fill="currentColor" />
    </svg>
  );
}
function AutoTextarea({
  value,
  onChange,
  id,
  label,
  className = "",
  placeholder = "",
  maxLength = 10000,
  describedBy,
  invalid = false,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
  label?: string;
  className?: string;
  placeholder?: string;
  maxLength?: number;
  describedBy?: string;
  invalid?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      id={id}
      aria-label={label}
      className={`resize-none ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      rows={3}
      style={{ resize: "none" }}
    />
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("after");
  const [language, setLanguage] = useState<Language>("English");
  const [script, setScript] = useState<Script>("native");
  const [drafts, setDrafts] = useState<Record<Mode, Draft>>({
    before: emptyDraft(),
    after: emptyDraft(),
  });
  const [details, setDetails] = useState<Details>(emptyDetails);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState(false);
  const [copied, setCopied] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [storageProblem, setStorageProblem] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [shortcut, setShortcut] = useState("your Flow shortcut");
  const request = useRef<AbortController | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const draft = drafts[mode];
  const kit = draft.kit;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.version === 1) {
          if (["before", "after"].includes(data.mode)) setMode(data.mode);
          if (["English", "Telugu", "Hindi"].includes(data.language))
            setLanguage(data.language);
          if (["native", "roman"].includes(data.script)) setScript(data.script);
          const restored: Record<Mode, Draft> = {
            before: emptyDraft(),
            after: emptyDraft(),
          };
          for (const m of ["before", "after"] as Mode[]) {
            const d = data.drafts?.[m];
            if (d && typeof d.input === "string")
              restored[m].input = d.input.slice(0, 6000);
            if (
              d?.kit &&
              d.kit.mode === m &&
              Array.isArray(d.kit.outputs) &&
              d.kit.outputs.every(
                (o: { id?: unknown; title?: unknown; text?: unknown }) =>
                  typeof o.id === "string" &&
                  typeof o.title === "string" &&
                  typeof o.text === "string",
              )
            )
              restored[m].kit = d.kit;
          }
          setDrafts(restored);
          if (
            data.details &&
            Object.keys(emptyDetails).every(
              (k) => typeof data.details[k] === "string",
            )
          )
            setDetails(data.details);
        }
      }
    } catch {
      setStorageProblem(true);
    }
    setReady(true);
    const platform = navigator.platform.toLowerCase();
    setShortcut(platform.includes("mac") ? "Fn" : "Ctrl + Win");
    const controller = new AbortController();
    fetch("/api/generate", { signal: controller.signal })
      .then(async (r) => (await r.json()) as { configured: boolean })
      .then((d) => setConfigured(!!d.configured))
      .catch(() => setConfigured(false));
    return () => {
      controller.abort();
      request.current?.abort();
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ version: 1, mode, language, script, drafts, details }),
      );
    } catch {
      setStorageProblem(true);
    }
  }, [ready, mode, language, script, drafts, details]);
  useEffect(() => {
    if (!helpOpen) return;
    const click = (e: MouseEvent) => {
      if (!helpRef.current?.contains(e.target as Node)) setHelpOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHelpOpen(false);
        document.getElementById("flow-help")?.focus();
      }
    };
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", click);
      document.removeEventListener("keydown", key);
    };
  }, [helpOpen]);

  function updateInput(value: string) {
    setDrafts((d) => ({ ...d, [mode]: { ...d[mode], input: value } }));
    setFieldError(false);
    setError("");
  }
  function changeMode(next: Mode) {
    if (next === mode || busy) return;
    setMode(next);
    setError("");
    setFieldError(false);
    setClearConfirm(false);
    setNotice("");
  }
  function tryExample() {
    if (busy) return;
    updateInput(samples[mode]);
    setNotice("Sample loaded. Choose a language, then generate.");
    document.getElementById("video-input")?.focus();
  }
  function updateOutput(id: string, text: string) {
    setDrafts((d) => {
      const old = d[mode];
      if (!old.kit) return d;
      return {
        ...d,
        [mode]: {
          ...old,
          kit: {
            ...old.kit,
            outputs: old.kit.outputs.map((o) =>
              o.id === id ? { ...o, text } : o,
            ),
          },
        },
      };
    });
  }
  async function copy(value: string, id: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setNotice(id === "all" ? "All results copied." : "Copied to clipboard.");
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(""), 2200);
    } catch {
      setNotice(
        "Clipboard is unavailable. Select the text and copy it with your keyboard.",
      );
      document.getElementById(`output-${id}`)?.focus();
    }
  }
  function clearSaved() {
    request.current?.abort();
    setDrafts({ before: emptyDraft(), after: emptyDraft() });
    setDetails({ ...emptyDetails });
    setError("");
    setNotice("Your saved input, details, and results have been cleared.");
    setClearConfirm(false);
    setDetailsOpen(false);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      setStorageProblem(true);
    }
    document.getElementById("video-input")?.focus();
  }
  async function generate(event?: FormEvent) {
    event?.preventDefault();
    if (request.current) return;
    setError("");
    setNotice("");
    setFieldError(false);
    if (draft.input.trim().length < 20) {
      setError(
        "Tell us a little more: include your topic and at least one detail about the video.",
      );
      setFieldError(true);
      document.getElementById("video-input")?.focus();
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    const activeMode = mode;
    const timer = setTimeout(() => controller.abort("timeout"), 65000);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          input: draft.input.trim(),
          language,
          script: language === "English" ? "native" : script,
          details,
        }),
        signal: controller.signal,
      });
      const data = (await response.json()) as Kit & {
        error?: string;
        clarification?: string;
      };
      if (!response.ok)
        throw new Error(
          data.error || "We could not create your results. Please try again.",
        );
      if (controller.signal.aborted) return;
      if (data.clarification) {
        setError(data.clarification);
        setFieldError(true);
        document.getElementById("video-input")?.focus();
        return;
      }
      setDrafts((d) => ({
        ...d,
        [activeMode]: { ...d[activeMode], kit: data },
      }));
      setNotice(
        data.sample
          ? "Example preview ready. These are prepared sample outputs."
          : "Your results are ready to edit and copy.",
      );
      setTimeout(
        () =>
          resultRef.current?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "instant"
              : "smooth",
            block: "start",
          }),
        100,
      );
    } catch (e) {
      if (controller.signal.aborted) {
        setError(
          controller.signal.reason === "timeout"
            ? "Generation took too long. Your input is saved—please try again."
            : "Generation stopped. Your input is still here.",
        );
      } else {
        setError(
          e instanceof Error
            ? e.message
            : "Connection lost. Check your connection and try again.",
        );
      }
    } finally {
      clearTimeout(timer);
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  const mismatched =
    kit &&
    (kit.language !== language ||
      (language !== "English" && kit.script !== script));
  return (
    <div className="app-shell">
      <a className="skip-link" href="#composer">
        Skip to creator tool
      </a>
      <header className="site-header">
        <a href="/" className="brand" aria-label="ReelReady home">
          <Logo />
          <span>
            reelready<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="header-right">
          <span className="open-note">
            <span /> No sign-up. Just create.
          </span>
          <div className="help-wrap" ref={helpRef}>
            <button
              type="button"
              className="flow-button"
              id="flow-help"
              aria-expanded={helpOpen}
              aria-controls="flow-guide"
              onClick={() => setHelpOpen(!helpOpen)}
            >
              <Volume2 size={15} /> Made for Wispr Flow <HelpCircle size={14} />
            </button>
            {helpOpen && (
              <div id="flow-guide" className="help-popover">
                <strong>Your voice, your shortcut.</strong>
                <p>
                  Click a text box, hold your Wispr Flow shortcut, and speak.
                  Release to insert your words.
                </p>
                <p>
                  On desktop, enable Flow’s Command Mode to revise selected
                  output text. Dictionary and Snippets help with names and
                  repeated details.
                </p>
                <p>
                  Typing works here too. Wispr runs separately on your device.
                </p>
                <a
                  href="https://wisprflow.ai/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Get Wispr Flow <ArrowUpRight size={14} />
                </a>
                <button
                  className="icon-button popover-close"
                  aria-label="Close Wispr guide"
                  onClick={() => setHelpOpen(false)}
                >
                  <X size={15} />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main>
        <section className="intro" aria-labelledby="page-title">
          <div className="intro-wave" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <h1 id="page-title">
            Your ideas.
            <br />
            <span>Ready for the world.</span>
          </h1>
          <p>
            Speak once. Get your plan and your posts.
            <br className="mobile-break" /> In the language that feels like you.
          </p>
        </section>
        <section
          className="studio"
          id="composer"
          aria-label="Create your content"
        >
          <div
            className="mode-switch"
            role="group"
            aria-label="Recording stage"
          >
            <button
              type="button"
              className={mode === "before" ? "mode active" : "mode"}
              aria-pressed={mode === "before"}
              disabled={!ready || busy}
              onClick={() => changeMode("before")}
            >
              <Lightbulb size={17} />
              <span>Before recording</span>
            </button>
            <button
              type="button"
              className={mode === "after" ? "mode active" : "mode"}
              aria-pressed={mode === "after"}
              disabled={!ready || busy}
              onClick={() => changeMode("after")}
            >
              <Clapperboard size={17} />
              <span>After recording</span>
            </button>
          </div>
          <form noValidate onSubmit={generate} className="composer-form">
            <div className="input-heading">
              <label htmlFor="video-input">
                {mode === "after"
                  ? "What’s your video about?"
                  : "What do you want to create?"}
              </label>
              <button
                type="button"
                className="example-button"
                disabled={!ready || busy}
                onClick={tryExample}
              >
                <WandSparkles size={14} />
                Try an example
              </button>
            </div>
            <div className={`input-surface ${fieldError ? "invalid" : ""}`}>
              <textarea
                id="video-input"
                value={draft.input}
                onChange={(e) => updateInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void generate();
                  }
                }}
                maxLength={6000}
                placeholder={
                  mode === "after"
                    ? "Tell us what happened, what you loved, and what your viewers should know. A little rambling is welcome."
                    : "A rough idea is all you need. Tell us the topic, who it’s for, and what you’d like to show."
                }
                aria-invalid={fieldError || undefined}
                aria-describedby={`input-hint${error ? " generation-error" : ""}`}
                disabled={!ready || busy}
                rows={5}
                style={{ resize: "none" }}
              />
              <div className="input-bottom">
                <span id="input-hint">
                  <Mic size={14} />
                  <span>
                    Hold <kbd>{shortcut}</kbd> to speak with Flow, or just type
                  </span>
                </span>
                <span className="input-count">
                  {draft.input.length.toLocaleString("en-IN")} / 6,000
                </span>
              </div>
            </div>
            <div className="preferences">
              <div className="select-field">
                <label htmlFor="output-language">
                  <Globe2 size={14} />
                  Output language
                </label>
                <div className="select-wrap">
                  <select
                    id="output-language"
                    value={language}
                    onChange={(e) => {
                      setLanguage(e.target.value as Language);
                      setError("");
                    }}
                    disabled={!ready || busy}
                  >
                    <option value="English">English</option>
                    <option value="Telugu">Telugu · తెలుగు</option>
                    <option value="Hindi">Hindi · हिन्दी</option>
                  </select>
                  <ChevronDown size={15} />
                </div>
              </div>
              <div className="select-field">
                <label htmlFor="output-script">Writing script</label>
                <div className="select-wrap">
                  <select
                    id="output-script"
                    value={language === "English" ? "native" : script}
                    onChange={(e) => {
                      setScript(e.target.value as Script);
                      setError("");
                    }}
                    disabled={!ready || busy || language === "English"}
                  >
                    <option value="native">
                      {language === "English"
                        ? "Latin (English)"
                        : "Native script"}
                    </option>
                    {language !== "English" && (
                      <option value="roman">Roman script (ABC)</option>
                    )}
                  </select>
                  <ChevronDown size={15} />
                </div>
              </div>
              <p className="language-note">
                Think in your language.
                <br />
                We’ll help with the words.
              </p>
            </div>
            <div className="details-section">
              <button
                type="button"
                className="details-toggle"
                aria-expanded={detailsOpen}
                aria-controls="creator-details"
                onClick={() => setDetailsOpen(!detailsOpen)}
              >
                <Plus size={16} className={detailsOpen ? "rotated" : ""} />
                <span>Add my details</span>
                <span className="optional">Optional</span>
              </button>
              {detailsOpen && (
                <div id="creator-details" className="details-content">
                  <div className="detail-field wide">
                    <label htmlFor="voice-examples">
                      Make it sound like you
                    </label>
                    <AutoTextarea
                      id="voice-examples"
                      value={details.voice}
                      onChange={(v) => setDetails((d) => ({ ...d, voice: v }))}
                      maxLength={3000}
                      placeholder="Paste 2–3 of your past captions. We’ll take cues from your style."
                    />
                  </div>
                  <div className="detail-field">
                    <label htmlFor="brand-name">Brand or creator name</label>
                    <input
                      id="brand-name"
                      value={details.brand}
                      maxLength={150}
                      placeholder="Names to get right"
                      onChange={(e) =>
                        setDetails((d) => ({ ...d, brand: e.target.value }))
                      }
                    />
                  </div>
                  <div className="detail-field">
                    <label htmlFor="brand-link">Link to include</label>
                    <input
                      id="brand-link"
                      type="url"
                      value={details.link}
                      maxLength={500}
                      placeholder="https://…"
                      onChange={(e) =>
                        setDetails((d) => ({ ...d, link: e.target.value }))
                      }
                    />
                  </div>
                  <div className="detail-field wide">
                    <label htmlFor="disclosure">
                      Call to action or disclosure
                    </label>
                    <input
                      id="disclosure"
                      value={details.disclosure}
                      maxLength={500}
                      placeholder="E.g. Save this for later. Or: #ad — paid partnership with…"
                      onChange={(e) =>
                        setDetails((d) => ({
                          ...d,
                          disclosure: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <p>
                    Your details stay in this browser and are included when you
                    generate.
                  </p>
                </div>
              )}
            </div>
            {error && (
              <div id="generation-error" className="inline-error" role="alert">
                <AlertCircle size={17} />
                <div>{error}</div>
              </div>
            )}
            <div className="generate-row">
              <p>
                <ShieldCheck size={14} />
                {storageProblem
                  ? "Browser saving unavailable. Keep this tab open."
                  : "Your latest draft stays in this browser."}
              </p>
              <button
                type="submit"
                className="generate-button"
                disabled={!ready || busy}
                aria-busy={busy}
              >
                {busy ? (
                  <>
                    <LoaderCircle className="spinner" size={17} />
                    <span>
                      Creating your {mode === "after" ? "posts" : "plan"}…
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      {mode === "after" ? "Create my posts" : "Create my plan"}
                    </span>
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </div>
            {busy && (
              <button
                className="cancel-button"
                type="button"
                onClick={() => request.current?.abort()}
              >
                Stop generation
              </button>
            )}
          </form>
        </section>
        <div className="below-composer">
          <span>
            {mode === "after"
              ? "Instagram, YouTube Shorts & X. One thought, three platforms."
              : "A hook, an outline & a shot checklist. Ready when you are."}
          </span>
          {configured === false && (
            <span className="preview-note">Example preview available</span>
          )}
        </div>
        {kit && (
          <section
            ref={resultRef}
            className="results"
            aria-labelledby="results-title"
          >
            <div className="results-heading">
              <div>
                <h2 id="results-title">
                  {mode === "after"
                    ? "Your publishing kit"
                    : "Your recording plan"}
                  <span className="result-dot" />
                </h2>
                <p>
                  {kit.sample
                    ? "Prepared example · try the editing and copy tools"
                    : `${kit.language}${kit.language !== "English" ? ` · ${kit.script === "roman" ? "Roman" : "Native"} script` : ""} · Make these words your own.`}
                </p>
              </div>
              <button
                type="button"
                className="copy-all"
                onClick={() =>
                  void copy(
                    kit.outputs
                      .map((o) => `${o.title}\n${o.text}`)
                      .join("\n\n"),
                    "all",
                  )
                }
              >
                {copied === "all" ? <Check size={15} /> : <Copy size={15} />}{" "}
                {copied === "all" ? "Copied" : "Copy all"}
              </button>
            </div>
            {mismatched && (
              <p className="result-notice">
                These results use your previous language settings. Generate
                again to apply your new choice.
              </p>
            )}
            {kit.sample && (
              <p className="sample-notice">
                This is a sample preview, not a response to custom content. Live
                generation needs a provider connection.
              </p>
            )}
            <div className="output-list">
              {kit.outputs.map((output) => {
                const count = characterCount(output.text);
                const limit =
                  output.id === "instagram"
                    ? 2200
                    : output.id === "youtubeTitle"
                      ? 100
                      : output.id === "youtubeDescription"
                        ? 5000
                        : output.id === "x"
                          ? 280
                          : 0;
                const measured =
                  output.id === "x" ? xCount(output.text) : count;
                const over = !!limit && measured > limit;
                const tags =
                  output.id === "instagram" ? hashtagCount(output.text) : 0;
                return (
                  <article
                    className={`output-sheet ${over ? "over-limit" : ""}`}
                    key={output.id}
                  >
                    <div className="output-heading">
                      <label htmlFor={`output-${output.id}`}>
                        {output.title}
                      </label>
                      <button
                        type="button"
                        className="copy-button"
                        onClick={() => void copy(output.text, output.id)}
                        aria-label={`Copy ${output.title}`}
                      >
                        {copied === output.id ? (
                          <Check size={14} />
                        ) : (
                          <Copy size={14} />
                        )}{" "}
                        {copied === output.id ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <AutoTextarea
                      id={`output-${output.id}`}
                      value={output.text}
                      onChange={(v) => updateOutput(output.id, v)}
                      className="output-text"
                      maxLength={15000}
                    />
                    <div className="output-meta">
                      <span>
                        {output.id === "x"
                          ? `${measured} weighted characters`
                          : `${count.toLocaleString("en-IN")} characters`}
                        {limit ? ` / ${limit.toLocaleString("en-IN")}` : ""}
                        {output.id === "instagram"
                          ? ` · ${tags} hashtag${tags === 1 ? "" : "s"}`
                          : ""}
                      </span>
                      <span>
                        {over
                          ? "Over limit — shorten before posting"
                          : tags > 5
                            ? "More than 5 hashtags — consider trimming"
                            : "Editable · Select text to refine with Flow"}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
            <p className="review-note">
              A starting point in your voice. Check facts, names, and language
              before posting.
            </p>
          </section>
        )}
        {!kit && (
          <div className="quiet-note">
            <div className="mini-wave" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <p>
              You bring the idea.
              <br />
              <strong>We’ll help it find the words.</strong>
            </p>
          </div>
        )}
      </main>
      <footer className="site-footer">
        <span>Made for creators who’d rather be creating.</span>
        <div>
          <a href="https://wisprflow.ai/" target="_blank" rel="noreferrer">
            Works with Wispr Flow <ArrowUpRight size={12} />
          </a>
          {(drafts.before.input ||
            drafts.after.input ||
            details.brand ||
            details.voice ||
            details.link ||
            details.disclosure) && (
            <button
              className="clear-button"
              onClick={() => setClearConfirm(!clearConfirm)}
            >
              <RotateCcw size={12} />
              Clear saved data
            </button>
          )}
        </div>
      </footer>
      {clearConfirm && (
        <div
          className="clear-confirm"
          role="region"
          aria-label="Clear saved browser data"
        >
          <p>
            Clear both drafts, results, and saved creator details from this
            browser?
          </p>
          <div>
            <button
              className="secondary-button"
              onClick={() => setClearConfirm(false)}
            >
              Keep my work
            </button>
            <button className="danger-button" onClick={clearSaved}>
              Clear saved data
            </button>
          </div>
        </div>
      )}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {notice}
      </div>
      {notice && (copied || notice.startsWith("Your saved")) && (
        <div className="toast" aria-hidden="true">
          <Check size={15} />
          {notice}
        </div>
      )}
    </div>
  );
}
