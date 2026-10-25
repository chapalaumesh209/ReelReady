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
  AlertCircle,
  X,
} from "lucide-react";
import { AutoTextarea, OutputEditor, SampleBadge } from "@/components/studio";
import {
  platforms,
  platformNames,
  languages,
  type Platform,
  type Plan,
  type Analysis,
  type Connections,
  type PublishJob,
} from "@/lib/workflow";
import {
  type Language,
  type Script,
  type Kit,
  characterCount,
  isPlaceholderKit,
  xCount,
} from "@/lib/content";
import { storeMedia, metadata, normalizeVideo } from "@/lib/browser-media";
import type { StoredVideo } from "@/lib/supabase";
import { cloudUpload } from "@/lib/storage-upload";
import {
  fresh,
  tomorrow,
  scheduledISO,
  sampleIdeas,
  type Draft,
} from "@/lib/reel";
import { CreatorDetails } from "@/components/studio/creator-details";
import { AudioEditor } from "@/components/studio/audio-editor";
import { WorkspaceShell } from "@/components/studio/workspace-shell";
import { InlineAccounts } from "@/components/studio/inline-accounts";
import { ConfirmDialog } from "@/components/studio/confirm-dialog";
const key = "reelready.flow.v2";
const steps = [
  { label: "Plan", icon: Mic },
  { label: "Record", icon: Clapperboard },
  { label: "Upload", icon: Upload },
  { label: "Audio & Voice", icon: Mic },
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
  const d = new Date(/T\d{2}:\d{2}$/.test(iso) ? scheduledISO(iso) : iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      })
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
    [originalURL, setOriginalURL] = useState(""),
    [dubURL, setDubURL] = useState(""),
    [connections, setConnections] = useState<Connections>({
      configured: false,
      accounts: {},
    }),
    [connectionLoaded, setConnectionLoaded] = useState(false),
    [samplesEnabled, setSamplesEnabled] = useState(false),
    [revision, setRevision] = useState(""),
    [preflight, setPreflight] = useState<
      import("@/lib/publish-preflight").PublishPreflight | null
    >(null),
    [storageWarning, setStorageWarning] = useState(false),
    [publishConfirm, setPublishConfirm] = useState(false),
    [retryConfirm, setRetryConfirm] = useState(false),
    [clock, setClock] = useState(0),
    [replanConfirm, setReplanConfirm] = useState(false),
    [planAttempted, setPlanAttempted] = useState(false),
    [saveFailed, setSaveFailed] = useState(false),
    [saveRetry, setSaveRetry] = useState(0),
    [pickerAttempted, setPickerAttempted] = useState(false),
    [cloudAvailable, setCloudAvailable] = useState<boolean | null>(null),
    [cloudHydrated, setCloudHydrated] = useState(false),
    [cloudSave, setCloudSave] = useState("local");
  useEffect(() => {
    queueMicrotask(() => setClock(Date.now()));
    const timer = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const localDraftPresent = useRef(false);
  const connectionReturnPending = useRef(false);
  const controller = useRef<AbortController | null>(null),
    operation = useRef(false),
    headingRef = useRef<HTMLHeadingElement>(null);
  const patch = (values: Partial<Draft>) => {
    localDraftPresent.current = true;
    if (cloudAvailable) setCloudSave("saving");
    setDraft((d) => ({ ...d, ...values }));
  };
  async function refreshConnections() {
    try {
      const state = await responseJSON<
        Connections & { aiConfigured: boolean; speechConfigured: boolean }
      >(await fetch("/api/connections"));
      setConnections(state);
      setConnectionLoaded(true);
      if (connectionReturnPending.current) {
        connectionReturnPending.current = false;
        setNotice(
          "Account status refreshed. Only verified connections are shown.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection check failed.");
      setConnectionLoaded(true);
    }
  }
  useEffect(() => {
    let cancelled = false;
    const connectionReturn = new URLSearchParams(location.search).get(
      "connect_status",
    );
    if (connectionReturn === "cancelled")
      queueMicrotask(() =>
        setNotice(
          "Connection cancelled. Your reel is saved; try connecting again when ready.",
        ),
      );
    if (connectionReturn === "error")
      queueMicrotask(() =>
        setError("Couldn’t connect your account. Please try again."),
      );
    connectionReturnPending.current = connectionReturn === "success";
    if (connectionReturn === "success")
      queueMicrotask(() => setNotice("Checking your account connection…"));
    (async () => {
      const restored = fresh();
      const params = new URLSearchParams(location.search);
      const runtime = await fetch("/api/limits", {
        signal: AbortSignal.timeout(8000),
      })
        .then((r) => responseJSON<{ samplesAvailable?: boolean }>(r))
        .catch(() => ({ samplesAvailable: false }));
      const samplesAvailable = runtime.samplesAvailable === true;
      if (cancelled) return;
      setSamplesEnabled(samplesAvailable);
      if (!samplesAvailable && params.has("sample")) {
        params.delete("sample");
        history.replaceState(
          {},
          "",
          `${location.pathname}${params.size ? `?${params}` : ""}`,
        );
      }
      let chosen = params.get("id") || params.get("new");
      // Resume the current reel in this browser; an explicit new/sample URL starts fresh.
      if (!chosen && !params.has("sample")) {
        try {
          const cached = JSON.parse(
            localStorage.getItem(key) || "null",
          ) as Draft | null;
          if (cached?.version === 2 && /^[a-f0-9-]{36}$/.test(cached.id)) {
            Object.assign(restored, fresh(), cached);
            restored.step =
              !cached.workflowVersion && cached.step >= 3
                ? cached.step + 1
                : cached.step;
            restored.workflowVersion = 3;
            chosen = cached.id;
          }
        } catch {
          /* Browser persistence is optional. */
        }
      }
      restored.id =
        chosen && /^[a-f0-9-]{36}$/.test(chosen) ? chosen : crypto.randomUUID();
      const sample = params.get("sample");
      if (sample === "judge") {
        restored.platforms = ["instagram", "youtube", "x"];
        restored.input =
          "A short reel showing an original purple waveform animation with a quiet test tone. No speech or product claims.";
      }
      if (sample === "food" || sample === "garden") {
        restored.input = sampleIdeas[sample];
        if (sample === "food") restored.languages = ["English", "Telugu"];
      }
      restored.scheduledLocal ||= tomorrow();
      restored.timezone ||= "Asia/Kolkata";
      if (chosen && !params.has("new") && !params.has("sample"))
        history.replaceState({}, "", `${location.pathname}?id=${restored.id}`);
      if (!cancelled) {
        setDraft(restored);
        setOriginal(null);
        setDubbed(null);
        setReady(true);
      }
    })();
    queueMicrotask(() => void refreshConnections());
    const handleFocus = () => {
      void refreshConnections();
    };
    window.addEventListener("focus", handleFocus);
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
        queueMicrotask(() => setStorageWarning(true));
      }
  }, [draft, ready]);
  useEffect(() => {
    if (!connectionLoaded) return;
    void fetch("/api/storage")
      .then((r) => responseJSON<{ configured: boolean }>(r))
      .then((s) => setCloudAvailable(s.configured))
      .catch(() => setCloudAvailable(false));
  }, [connectionLoaded]);
  useEffect(() => {
    let alive = true;
    let localURL = "";
    if (original) {
      localURL = URL.createObjectURL(original);
      queueMicrotask(() => {
        if (alive) setOriginalURL(localURL);
      });
    } else if (draft.originalAsset) {
      void fetch(
        `/api/storage?token=${encodeURIComponent(draft.originalAsset.token)}`,
      )
        .then((r) => responseJSON<{ url: string }>(r))
        .then((d) => {
          if (alive) setOriginalURL(d.url);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    } else
      queueMicrotask(() => {
        if (alive) setOriginalURL("");
      });
    return () => {
      alive = false;
      if (localURL) URL.revokeObjectURL(localURL);
    };
  }, [original, draft.originalAsset]);
  useEffect(() => {
    let alive = true;
    let localURL = "";
    if (dubbed) {
      localURL = URL.createObjectURL(dubbed);
      queueMicrotask(() => {
        if (alive) setDubURL(localURL);
      });
    } else if (draft.englishAsset) {
      void fetch(
        `/api/storage?token=${encodeURIComponent(draft.englishAsset.token)}`,
      )
        .then((r) => responseJSON<{ url: string }>(r))
        .then((d) => {
          if (alive) setDubURL(d.url);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    } else
      queueMicrotask(() => {
        if (alive) setDubURL("");
      });
    return () => {
      alive = false;
      if (localURL) URL.revokeObjectURL(localURL);
    };
  }, [dubbed, draft.englishAsset]);
  useEffect(() => {
    if (cloudAvailable === false) {
      queueMicrotask(() => setCloudHydrated(true));
      return;
    }
    if (!ready || !cloudAvailable) return;
    let alive = true;
    void fetch(
      new URLSearchParams(location.search).get("id")
        ? `/api/reels?id=${encodeURIComponent(new URLSearchParams(location.search).get("id")!)}`
        : "/api/preferences",
    )
      .then((r) =>
        responseJSON<{
          state: Draft | null;
          title?: string;
          details?: Draft["details"];
        }>(r),
      )
      .then(({ state, title, details }) => {
        if (alive && details) setDraft((d) => ({ ...d, details }));
        if (
          alive &&
          state?.details &&
          new URLSearchParams(location.search).has("new")
        )
          setDraft((d) => ({
            ...d,
            details: state.details,
            languages: state.languages || ["English"],
            script: state.script || "native",
          }));
        if (
          alive &&
          state &&
          !localDraftPresent.current &&
          !new URLSearchParams(location.search).has("new") &&
          !new URLSearchParams(location.search).has("sample") &&
          state.version === 2 &&
          typeof state.id === "string"
        ) {
          setDraft({
            ...fresh(),
            ...state,
            title: title || state.title,
            workflowVersion: 3,
            step:
              !state.workflowVersion && state.step >= 3
                ? state.step + 1
                : state.step,
          });
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setCloudHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, [ready, cloudAvailable]);
  useEffect(() => {
    if (!ready || !cloudAvailable || !cloudHydrated) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setCloudSave("saving");
        setSaveFailed(false);
      }
    });
    const timer = setTimeout(() => {
      void fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: draft }),
        signal: controller.signal,
      })
        .then((r) => {
          if (!r.ok) throw new Error();
          if (!controller.signal.aborted) {
            setCloudSave("saved");
            const params = new URLSearchParams(location.search);
            if (!params.has("id") || params.has("new") || params.has("sample"))
              history.replaceState({}, "", `/?id=${draft.id}`);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setCloudSave("local");
            setSaveFailed(true);
          }
        });
    }, 1200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, ready, cloudAvailable, cloudHydrated, saveRetry]);
  const hasOriginal = !!original || !!draft.originalAsset;
  const preview =
    draft.variant === "english"
      ? draft.audioReady
        ? dubURL
        : ""
      : originalURL;
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
  useEffect(() => {
    if (!ready || !cloudHydrated || !connectionLoaded) return;
    const timer = setTimeout(() => {
      const box = Array.from(
        document.querySelectorAll<HTMLTextAreaElement>(
          ".workspace-panel textarea",
        ),
      ).find(
        (el) => !el.matches(":disabled") && el.getClientRects().length > 0,
      );
      box?.focus();
    }, 180);
    return () => clearTimeout(timer);
  }, [draft.step, ready, cloudHydrated, connectionLoaded]);
  function go(step: number) {
    patch({ step });
    setError("");
    setNotice("");
    requestAnimationFrame(() => headingRef.current?.focus());
  }
  function toggle<T extends string | number>(list: T[], value: T) {
    return list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
  }
  function planGenerate(confirmed = false) {
    setPlanAttempted(true);
    if (hasOriginal && !confirmed) {
      setReplanConfirm(true);
      return;
    }
    setReplanConfirm(false);
    void run("Finding three reel ideas…", async (signal) => {
      if (draft.input.trim().length < 20)
        throw new Error(
          "Tell us a little more about the reel—at least 20 characters.",
        );
      if (!draft.platforms.length || !draft.languages.length)
        throw new Error("Choose at least one platform and one language.");
      const when = new Date(scheduledISO(draft.scheduledLocal));
      if (!Number.isFinite(when.getTime()))
        throw new Error("Choose the date and time you want to publish.");
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
        ...(hasOriginal ? { id: crypto.randomUUID() } : {}),
        plan,
        planSignature: signature(draft),
        selected: 0,
        audioReady: false,
        audioLabel: "",
        beatChecks: [],
        shotChecks: [],
        token: "",
        analysis: null,
        kits: {},
        meta: null,
        fileName: "",
        originalAsset: null,
        englishAsset: null,
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
  async function attachSampleVideo() {
    if (busy || !samplesEnabled || !connections.demo) return;
    try {
      const r = await fetch("/samples/reelready-demo.mp4");
      if (!r.ok)
        throw new Error("The sample could not be opened. Please retry.");
      await acceptVideo(
        new File([await r.blob()], "reelready-demo.mp4", { type: "video/mp4" }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function acceptVideo(selectedFile: File) {
    if (busy) return;
    void run("Checking your recording…", async (signal) => {
      const file = normalizeVideo(selectedFile);
      const limits = await fetch("/api/limits", { signal }).then(
        (r) => r.json() as Promise<import("@/lib/limits").PublicLimits>,
      );
      const { uploadProblem } = await import("@/lib/limits");
      const sizeProblem = uploadProblem(file.size, undefined, limits);
      if (sizeProblem) throw new Error(sizeProblem);
      if (!["video/mp4", "video/quicktime", "video/webm"].includes(file.type))
        throw new Error("Choose an MP4, MOV or WebM video.");
      const meta = await metadata(file, signal);
      const durationProblem = uploadProblem(file.size, meta.duration, limits);
      if (durationProblem) throw new Error(durationProblem);

      let available = cloudAvailable;
      if (available === null) {
        available = (
          await responseJSON<{ configured: boolean }>(
            await fetch("/api/storage", { signal }),
          )
        ).configured;
        setCloudAvailable(available);
      }
      let originalAsset: StoredVideo | null = null;
      if (available)
        originalAsset = await cloudUpload(
          file,
          file.name,
          draft.id,
          "original",
          signal,
          setBusy,
          meta,
        );
      else
        throw new Error(
          "Cloud storage is not connected. Configure Supabase before uploading; your previous recording is unchanged.",
        );
      if (draft.token) void removeRemote(draft.token);
      setOriginal(file);
      setDubbed(null);
      patch({
        fileName: file.name,
        audioReady: false,
        audioLabel: "",
        originalAsset,
        englishAsset: null,
        meta,
        token: "",
        analysis: null,
        kits: {},
        job: null,
        dubScript: "",
        variant: "original",
      });
      await Promise.all([
        storeMedia("original", null),
        storeMedia("dubbed", null),
      ]).catch(() => {});
      const audio = await post<{ source_id: string }>(
        "/api/audio",
        { action: "init", reelId: draft.id, token: originalAsset.token },
        signal,
      );
      void fetch("/api/media/worker-status", { signal })
        .then((r) => r.json() as Promise<{ status: string }>)
        .then((status) => {
          if (status.status === "online")
            return post(
              "/api/media/analyze",
              { reelId: draft.id, sourceId: audio.source_id },
              signal,
            );
        })
        .catch(() => {});
      setNotice(
        "Recording uploaded and saved privately in Supabase. Continue to Audio & Voice when you’re ready.",
      );
    });
  }
  async function ensureVideo(signal: AbortSignal, variant = draft.variant) {
    const selectedAsset =
      variant === "english" ? draft.englishAsset : draft.originalAsset;
    if (variant === "english" && (!draft.audioReady || !selectedAsset))
      throw new Error(
        "Finish and approve the selected English video before analyzing captions.",
      );
    if (draft.token) {
      try {
        const status = await responseJSON<{
          state: string;
          sourcePath?: string;
        }>(
          await fetch(`/api/video?token=${encodeURIComponent(draft.token)}`, {
            signal,
          }),
        );
        if (
          status.state === "ACTIVE" &&
          status.sourcePath === selectedAsset?.path
        )
          return draft.token;
      } catch (e) {
        if (signal.aborted) throw e;
      }
    }
    if (!hasOriginal) throw new Error("Upload your recording first.");
    let asset = selectedAsset;
    if (cloudAvailable && !asset && original) {
      asset = await cloudUpload(
        original,
        draft.fileName,
        draft.id,
        "original",
        signal,
        setBusy,
        draft.meta || undefined,
      );
      patch({ originalAsset: asset });
    }
    setBusy("Uploading your recording for understanding…");
    const source = original;
    const file = await responseJSON<{ token: string; state: string }>(
      await fetch("/api/video", {
        method: "POST",
        headers: asset
          ? { "Content-Type": "application/json" }
          : {
              "Content-Type": source!.type,
              "X-File-Size": String(source!.size),
            },
        body: asset ? JSON.stringify({ assetToken: asset.token }) : source,
        signal,
      }),
    );
    patch({ token: file.token });
    let processingState = file.state;
    for (let n = 0; n < 40; n++) {
      if (processingState === "ACTIVE") return file.token;
      if (processingState === "FAILED")
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
      processingState = state.state;
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
    const sameSource = draft.analysis?.assetPath === analysis.assetPath;
    const preserveCurrent =
      sameSource && !isPlaceholderKit(draft.kits[language]);
    const kit = await post<Kit>(
      "/api/generate",
      {
        mode: "after",
        professional: true,
        input:
          `Actual recorded content: ${analysis.summary}\nRecorded transcript: ${analysis.transcript}\nCreator filming note: ${draft.filmingNote}`.slice(
            0,
            4000,
          ),
        language,
        script: draft.script,
        details: draft.details,
        current: preserveCurrent
          ? draft.kits[language]?.outputs.map(({ id, text }) => ({
              id,
              text,
            }))
          : undefined,
        instruction:
          draft.kits[language] && preserveCurrent
            ? "Refresh the wording while preserving my manual facts and details."
            : "",
      },
      signal,
    );
    if (kit.clarification) throw new Error(kit.clarification);
    return kit;
  }
  function analyze(variant?: "original") {
    void run("Preparing your video review…", async (signal) => {
      const token = await ensureVideo(signal, variant);
      setBusy("Preparing your recorded-content summary and captions…");
      const analysis = await post<Analysis>(
        "/api/review",
        {
          token,
          idea: JSON.stringify(draft.plan?.ideas[draft.selected]),
          revision,
          previous: draft.analysis,
          duration: draft.meta?.duration,
          filmingNote: draft.filmingNote,
        },
        signal,
      );
      // Keep prior captions until both real analysis and its new kit have succeeded.
      setBusy("Writing and reviewing your platform captions…");
      const kit = await makeKit(analysis, "English", signal);
      patch({
        analysis,
        token,
        kits: { English: kit },
        kitLanguage: "English",
        step: 4,
      });
      setRevision("");
      requestAnimationFrame(() => headingRef.current?.focus());
    });
  }
  function reviseKit(field?: string) {
    void run("Applying your caption changes…", async (signal) => {
      const current = draft.kits[draft.kitLanguage];
      if (!current || !draft.analysis)
        throw new Error("Generate your publishing kit first.");
      const kit = await post<Kit>(
        "/api/ai/change-request",
        {
          mode: "after",
          professional: true,
          input: `${draft.analysis.summary}\n${draft.filmingNote}`.slice(
            0,
            4000,
          ),
          language: draft.kitLanguage,
          script: draft.script,
          details: draft.details,
          current: current.outputs.map(({ id, text }) => ({ id, text })),
          instruction:
            revision.trim() ||
            "Rewrite this output to be clearer and more concise. Preserve all supplied facts and the creator’s tone.",
          ...(field ? { fields: [field] } : {}),
        },
        signal,
      );
      patch({ kits: { ...draft.kits, [draft.kitLanguage]: kit } });
      setRevision("");
      setNotice(
        kit.sample
          ? "Sample rewrite: only simple shortening is available while the writing service is unavailable."
          : "Your caption changes are ready to review.",
      );
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
  function deliveryStatus() {
    void run("Checking delivery…", async (signal) => {
      if (!draft.job) return;
      const job = await responseJSON<PublishJob>(
        await fetch(
          `/api/publish/status?id=${encodeURIComponent(draft.job.id || draft.job.token)}`,
          { signal },
        ),
      );
      patch({ job });
    });
  }
  function retryFailed() {
    setRetryConfirm(false);
    void run("Retrying failed destinations…", async (signal) => {
      if (!draft.job) return;
      const job = await post<PublishJob>(
        "/api/publish",
        {
          action: "retry",
          id: draft.job.id || draft.job.token,
          confirmed: true,
        },
        signal,
      );
      patch({ job });
      setNotice(
        "Only failed destinations were submitted for retry. Successful posts are kept.",
      );
    });
  }
  const activeKit = draft.kits[draft.kitLanguage],
    idea = draft.plan?.ideas[draft.selected],
    dubValid =
      !!draft.englishAsset &&
      (draft.audioReady === true ||
        (!draft.workflowVersion &&
          draft.dubScript === draft.analysis?.englishScript));
  const finalVideo =
    draft.variant === "english" ? (dubValid ? dubbed : null) : original;
  const finalAsset =
    draft.variant === "english"
      ? dubValid
        ? draft.englishAsset
        : null
      : draft.originalAsset;
  const selectedMediaPath =
    draft.variant === "english"
      ? draft.englishAsset?.path
      : draft.originalAsset?.path;
  const shouldReanalyze =
    !connections.demo &&
    (!!draft.analysis?.sample ||
      draft.analysis?.origin !== "recording" ||
      draft.analysis?.assetPath !== selectedMediaPath);
  const needsRealReview =
    !connections.demo &&
    (!!draft.analysis?.sample ||
      draft.analysis?.origin !== "recording" ||
      draft.analysis?.assetPath !== selectedMediaPath ||
      isPlaceholderKit(activeKit));
  const receiptReady = !!draft.job && draft.job.status !== "pending";
  const allConnected =
    connections.demo ||
    draft.platforms.every((p) => connections.accounts[p]?.connected);
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
  function publishPayload() {
    return {
      action: "prepare" as const,
      confirmed: true as const,
      draftId: draft.id,
      platforms: draft.platforms,
      scheduledAt:
        draft.timing === "schedule"
          ? new Date(scheduledISO(draft.scheduledLocal)).toISOString()
          : null,
      instagram: finalTexts.instagram || "",
      youtubeTitle: finalTexts.youtubeTitle || "",
      youtubeDescription: finalTexts.youtubeDescription || "",
      x: finalTexts.x || "",
      language: draft.kitLanguage,
      dubbed: draft.variant === "english",
      size: finalAsset?.size || finalVideo?.size || 1,
      assetToken: finalAsset?.token,
      duration: draft.meta?.duration || 1,
      width: draft.meta?.width || 1,
      height: draft.meta?.height || 1,
    };
  }
  function checkBeforePublishing() {
    void run("Checking your publishing setup…", async (signal) => {
      setPreflight(
        await post<import("@/lib/publish-preflight").PublishPreflight>(
          "/api/publish/preflight",
          publishPayload(),
          signal,
        ),
      );
    });
  }
  function publish() {
    setPublishConfirm(false);
    void run(
      draft.timing === "schedule"
        ? "Scheduling your reel…"
        : "Sending your reel…",
      async (signal) => {
        if ((!finalVideo && !finalAsset) || !draft.meta || !activeKit)
          throw new Error("Complete the video and caption review first.");
        if (draft.variant === "english" && !dubValid)
          throw new Error(
            "Your audio settings changed. Approve or render the selected version in Audio & Voice before publishing.",
          );
        const payload = publishPayload();
        if (!finalAsset)
          throw new Error(
            "Finish saving your video to cloud storage before publishing.",
          );
        const prepared =
          draft.job && draft.job.status === "pending"
            ? { ...draft.job, status: "pending" }
            : await post<PublishJob & { status?: string }>(
                "/api/publish",
                payload,
                signal,
              );
        patch({ job: prepared });
        const job =
          prepared.status === "pending"
            ? await post<PublishJob>(
                "/api/publish",
                {
                  action: "send",
                  id: prepared.id,
                  confirmed: true,
                },
                signal,
              )
            : prepared;
        patch({ job });
        setNotice(
          job.demo
            ? "Demo mode: nothing was posted."
            : job.deliveries.some((d) => d.state === "scheduled")
              ? "Your reel has been accepted for scheduling."
              : "Your request is saved. Check each destination’s delivery below.",
        );
      },
    );
  }
  function reset() {
    void run("Starting another reel…", async () => {
      if (cloudAvailable)
        await responseJSON(
          await fetch("/api/draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: draft }),
          }),
        );
      const next = fresh();
      next.id = crypto.randomUUID();
      next.details = draft.details;
      history.replaceState({}, "", `/?id=${next.id}`);
      setOriginal(null);
      setDubbed(null);
      setDraft(next);
      setRevision("");
      setNotice("");
    });
  }
  useEffect(() => {
    if (!connectionLoaded || !cloudHydrated || !draft.id) return;
    let active = true;
    void fetch(`/api/publish/status?reelId=${encodeURIComponent(draft.id)}`)
      .then((r) => (r.ok ? responseJSON<PublishJob>(r) : null))
      .then((job) => {
        if (active && job?.id)
          setDraft((d) => ({
            ...d,
            job,
            step: 5,
            timing: job.scheduledAt ? "schedule" : "now",
          }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [connectionLoaded, cloudHydrated, draft.id]);
  const pollingID = draft.job?.id || draft.job?.token;
  const pollingDone = draft.job?.done;
  useEffect(() => {
    if (!pollingID || pollingDone) return;
    let count = 0,
      active = true;
    const timer = setInterval(() => {
      if (++count > 30) {
        clearInterval(timer);
        return;
      }
      void fetch(`/api/publish/status?id=${encodeURIComponent(pollingID)}`)
        .then((r) => (r.ok ? responseJSON<PublishJob>(r) : null))
        .then((job) => {
          if (active && job?.id) setDraft((d) => ({ ...d, job }));
        })
        .catch(() => {});
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pollingID, pollingDone]);
  return (
    <WorkspaceShell
      section="studio"
      title="Reel studio"
      actions={
        <span
          className={`save-indicator ${cloudSave === "saved" ? "is-saved" : ""}`}
          role="status"
        >
          {cloudSave === "saving" ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Check size={14} />
          )}
          {cloudSave === "saved"
            ? "Saved"
            : cloudSave === "saving"
              ? "Saving…"
              : "Saved on this device"}
        </span>
      }
    >
      <div className="studio-shell">
        <main id="workspace">
          <h1 className="sr-only">Create your reel</h1>
          <div className="flow-progress" aria-label="Reel progress">
            <div className="flow-progress-label">
              <span>{steps[draft.step]?.label}</span>
              <span>
                Step {draft.step + 1} of {steps.length}
              </span>
            </div>
            <ol>
              {steps.map((step, i) => (
                <li
                  key={step.label}
                  className={i <= draft.step ? "reached" : ""}
                  aria-current={i === draft.step ? "step" : undefined}
                >
                  <span className="sr-only">{step.label}</span>
                </li>
              ))}
            </ol>
          </div>
          {connections.demo && (
            <p className="demo-banner" role="status">
              Demo publishing · Nothing will be posted.
            </p>
          )}
          {saveFailed && (
            <p className="message error" role="alert">
              Cloud saving is unavailable. Your latest edits are kept in this
              browser.
              <button
                className="quiet"
                onClick={() => setSaveRetry((n) => n + 1)}
              >
                Retry saving
              </button>
            </p>
          )}
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
          </div>
          <fieldset
            className="flow-fields"
            disabled={!ready || !connectionLoaded || !cloudHydrated || !!busy}
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
                      Describe your video. We’ll help you plan it and get it
                      posted.
                    </p>
                  </div>
                  <Mic className="heading-icon" size={25} />
                </div>
                <details
                  className={`plan-brief ${draft.plan ? "has-plan" : ""}`}
                  open={!draft.plan}
                >
                  <summary>Edit your brief</summary>
                  <label className="field-label" htmlFor="idea">
                    Your reel idea
                  </label>
                  <div className="idea-input">
                    <AutoTextarea
                      id="idea"
                      error={
                        planAttempted && draft.input.trim().length < 20
                          ? "Add at least 20 characters about what your reel will show."
                          : ""
                      }
                      onSubmit={planGenerate}
                      value={draft.input}
                      onChange={(input) => patch({ input })}
                      placeholder="A breakfast reel: make a mango yogurt bowl, keep it friendly, and ask viewers what fruit they’d add."
                      rows={3}
                    />
                    <div className="input-footer">
                      <span>
                        <Mic size={14} /> Enter to generate · Shift+Enter for a
                        new line
                      </span>
                      {samplesEnabled && connections.demo && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            patch({
                              input: sampleIdeas.food,
                              languages: ["English", "Telugu"],
                            })
                          }
                        >
                          Try an example
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="plan-destinations">
                    <span className="field-label">Post to</span>
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
                  </div>
                  <details className="flow-options">
                    <summary>
                      Language & schedule{" "}
                      <span>
                        {draft.languages.join(", ")} ·{" "}
                        {formatDate(draft.scheduledLocal)}
                      </span>
                    </summary>
                    <div className="schedule-row">
                      <div>
                        <label className="field-label" htmlFor="schedule">
                          When do you want to publish?
                        </label>
                        <input
                          id="schedule"
                          type="datetime-local"
                          value={draft.scheduledLocal}
                          onChange={(e) =>
                            patch({ scheduledLocal: e.target.value })
                          }
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
                          <option value="roman">
                            Roman script (Telugu / Hindi)
                          </option>
                        </select>
                        <p className="hint">
                          Roman keeps your language, written in Latin letters.
                        </p>
                      </div>
                    </div>
                    <div className="choice-row">
                      <fieldset>
                        <legend className="field-label">
                          Caption languages
                        </legend>
                        <div className="pills">
                          {languages.map((l) => (
                            <label
                              className={`choice ${draft.languages.includes(l) ? "selected" : ""}`}
                              key={l}
                            >
                              <input
                                type="checkbox"
                                checked={draft.languages.includes(l)}
                                disabled={l === "English"}
                                onChange={() =>
                                  patch({
                                    languages: toggle(draft.languages, l),
                                  })
                                }
                              />
                              {l}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </div>
                  </details>
                  <CreatorDetails
                    value={draft.details}
                    onChange={(details) => patch({ details })}
                  />
                  <div className="action-row">
                    <span />
                    <button className="primary" onClick={() => planGenerate()}>
                      {draft.plan ? "Regenerate ideas" : "Generate reel ideas"}
                      <ArrowRight size={17} />
                    </button>
                  </div>
                </details>
                {replanConfirm && (
                  <div
                    className="new-confirm"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setReplanConfirm(false);
                    }}
                  >
                    <p>
                      Replace this reel’s plan, recording and review? Download
                      your video first. Accepted schedules stay active and keep
                      their cloud videos.
                    </p>
                    <button
                      className="secondary"
                      autoFocus
                      onClick={() => setReplanConfirm(false)}
                    >
                      Keep this plan
                    </button>
                    <button
                      className="danger"
                      onClick={() => planGenerate(true)}
                    >
                      Replace & regenerate
                    </button>
                  </div>
                )}
                {draft.plan?.sample && (
                  <p className="hint warning">
                    <SampleBadge /> Review and edit this plan before recording.
                  </p>
                )}
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
                            disabled={hasOriginal}
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
                    <details className="flow-options plan-timing">
                      <summary>Recording time & platform plan</summary>
                      <p>Record by {formatDate(draft.plan.recordBy)}</p>
                      <p>{draft.plan.schedulingNote}</p>
                      {draft.plan.suggestions?.map((suggestion) => (
                        <p key={suggestion.platform}>
                          <strong>{platformNames[suggestion.platform]}</strong>{" "}
                          · {formatDate(suggestion.time)}
                          <br />
                          {suggestion.reason}
                        </p>
                      ))}
                      <p className="hint">
                        {draft.plan.languagePlan} Suggestions are estimates, not
                        your analytics.
                      </p>
                    </details>
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
            {draft.step === 1 && idea && (
              <section className="workspace-panel">
                <div className="panel-heading">
                  <div>
                    <h2 ref={headingRef} tabIndex={-1}>
                      Make it yours. Hit record.
                    </h2>
                    <p>Keep the plan nearby while you film.</p>
                  </div>
                  <Clapperboard size={25} />
                </div>
                <h3>{idea.title}</h3>
                <blockquote className="record-hook">{idea.hook}</blockquote>
                <p className="record-deadline">
                  {draft.plan && Date.parse(draft.plan.recordBy) > clock
                    ? `${Math.ceil((Date.parse(draft.plan.recordBy) - clock) / 60000)} minutes until your suggested record-by time`
                    : "Your suggested recording time is here. Film when you are ready."}
                </p>
                <div className="recording-plan">
                  <div>
                    <h3>Story beats</h3>
                    {idea.outline.map((beat, i) => (
                      <label className="shot-check" key={i}>
                        <input
                          type="checkbox"
                          checked={draft.beatChecks.includes(i)}
                          onChange={() =>
                            patch({ beatChecks: toggle(draft.beatChecks, i) })
                          }
                        />
                        {beat}
                      </label>
                    ))}
                  </div>
                  <div>
                    <h3>Shots to get</h3>
                    {idea.shots.map((shot, i) => (
                      <label className="shot-check" key={i}>
                        <input
                          type="checkbox"
                          checked={draft.shotChecks.includes(i)}
                          onChange={() =>
                            patch({ shotChecks: toggle(draft.shotChecks, i) })
                          }
                        />
                        {shot}
                      </label>
                    ))}
                  </div>
                </div>
                <details className="filming-notes flow-options">
                  <summary>
                    Add a filming note <span>Optional</span>
                  </summary>
                  <label className="field-label" htmlFor="filming-note">
                    Filming notes
                  </label>
                  <AutoTextarea
                    id="filming-note"
                    value={draft.filmingNote}
                    onChange={(filmingNote) => patch({ filmingNote })}
                    rows={2}
                    placeholder="A prop to bring, a detail to mention, a shot you don’t want to forget…"
                  />
                </details>
                <div className="action-row">
                  <button className="quiet" onClick={() => go(0)}>
                    Back to plan
                  </button>
                  <button className="primary" onClick={() => go(2)}>
                    I’ve recorded it <ArrowRight size={17} />
                  </button>
                </div>
              </section>
            )}
            {draft.step === 2 && (
              <section className="workspace-panel">
                <div className="panel-heading">
                  <div>
                    <h2 ref={headingRef} tabIndex={-1}>
                      Bring your recording back here.
                    </h2>
                    <p>Choose your video, or drop it below.</p>
                  </div>
                  <Clapperboard size={25} className="heading-icon" />
                </div>

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
                    {hasOriginal
                      ? "Your recording is here"
                      : "Your reel, ready for its next step"}
                  </h3>
                  <p>
                    Drop a video, paste a copied video file, or choose one
                    below.
                  </p>
                  <label className="field-label" htmlFor="recording-file">
                    {hasOriginal ? "Replace recording" : "Upload video"}
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
                    MP4, MOV or WebM · upload limits shown before saving
                  </span>
                </div>
                {hasOriginal && (
                  <div className="video-block">
                    <video
                      crossOrigin="anonymous"
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
                        {(
                          (original?.size || draft.originalAsset?.size || 0) /
                          1024 /
                          1024
                        ).toFixed(1)}{" "}
                        MB
                      </span>
                    </div>
                  </div>
                )}
                {draft.meta && (
                  <div className="media-warnings" role="status">
                    {draft.meta.width > draft.meta.height && (
                      <p className="hint warning">
                        Landscape video: this may not qualify as a YouTube
                        Short. Review the destination warnings before
                        publishing. video. Instagram may crop the frame.
                      </p>
                    )}
                    {draft.meta.duration > 180 &&
                      draft.platforms.includes("youtube") && (
                        <p className="hint warning">
                          This recording is longer than the supported Shorts
                          duration. Export a shorter version or deselect YouTube
                          before publishing.
                        </p>
                      )}
                    {draft.meta.duration > 140 &&
                      draft.platforms.includes("x") && (
                        <p className="hint warning">
                          This X publishing setup supports up to 140 seconds.
                          Keep the upload; choose another destination or shorten
                          the video before publishing.
                        </p>
                      )}
                  </div>
                )}
                {samplesEnabled && connections.demo && (
                  <div className="sample-shortcut">
                    <span>Just trying it out?</span>
                    <button
                      className="text-button"
                      onClick={() => void attachSampleVideo()}
                    >
                      Use a sample video
                    </button>
                  </div>
                )}
                <details className="flow-options">
                  <summary>
                    Add recording notes <span>Optional</span>
                  </summary>
                  <label className="field-label" htmlFor="filming-note">
                    Anything that changed while filming?
                  </label>
                  <AutoTextarea
                    id="filming-note"
                    value={draft.filmingNote}
                    onChange={(filmingNote) => patch({ filmingNote })}
                    maxLength={4000}
                    placeholder="What changed, what you actually showed, and anything the captions should mention."
                  />
                </details>
                <p className="privacy-note">
                  Your video stays private. Analysis sends a copy to the AI
                  service when you continue to captions.
                </p>
                <div className="action-row">
                  <button className="quiet" onClick={() => go(1)}>
                    <ArrowLeft size={16} />
                    Back to recording
                  </button>
                  <button
                    className="primary"
                    disabled={!hasOriginal}
                    onClick={() => go(3)}
                  >
                    Continue to audio & voice
                    <ArrowRight size={17} />
                  </button>
                </div>
              </section>
            )}
            {draft.step === 3 && draft.originalAsset && (
              <AudioEditor
                reelId={draft.id}
                token={draft.originalAsset.token}
                originalURL={originalURL}
                creatorNote={draft.filmingNote}
                onBack={() => go(2)}
                onContinue={analyze}
                onPending={() =>
                  patch({ audioReady: false, variant: "english" })
                }
                onReady={(asset, original, audioLabel, meta) => {
                  setDubbed(null);
                  patch({
                    englishAsset: original ? null : asset,
                    variant: original ? "original" : "english",
                    audioReady: true,
                    audioLabel,
                    meta:
                      meta.duration && meta.width && meta.height
                        ? {
                            duration: meta.duration,
                            width: meta.width,
                            height: meta.height,
                          }
                        : draft.meta,
                  });
                }}
              />
            )}
            {draft.step === 4 && (
              <section className="workspace-panel">
                <div className="panel-heading">
                  <div>
                    <h2 ref={headingRef} tabIndex={-1}>
                      Same story. A wider audience.
                    </h2>
                    <p>
                      Review your selected video and edit the captions for each
                      platform.
                    </p>
                  </div>
                  <Globe2 size={25} className="heading-icon" />
                </div>
                {draft.analysis?.sample && (
                  <p className="hint warning">
                    <SampleBadge /> This summary uses your notes, not video
                    analysis.
                  </p>
                )}
                <div className="review-layout">
                  <div className="preview-column">
                    {preview ? (
                      <video
                        crossOrigin="anonymous"
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
                    <p className="hint">
                      {draft.audioLabel || "Selected original recording"}
                    </p>
                    <button className="quiet" onClick={() => go(3)}>
                      Edit audio & voice
                    </button>
                    {preview && (
                      <a
                        className="download-link"
                        href={preview}
                        download={
                          draft.variant === "english"
                            ? "reelready-edited.mp4"
                            : draft.fileName
                        }
                      >
                        <Download size={15} />
                        Download{" "}
                        {draft.variant === "english"
                          ? "edited video"
                          : "original"}
                      </a>
                    )}
                    <p className="hint">
                      {draft.analysis?.sourceLanguage} source ·{" "}
                      {Math.round(draft.meta?.duration || 0)}s
                    </p>
                  </div>
                  <div className="script-column">
                    <details>
                      <summary>What’s in your video</summary>
                      <p>{draft.analysis?.summary}</p>
                      <details>
                        <summary>Observed content & transcript</summary>
                        <p className="transcript">
                          {draft.analysis?.transcript}
                        </p>
                        <p>{draft.analysis?.audioNote}</p>
                      </details>
                    </details>
                  </div>
                </div>
                <details className="revision-box flow-options">
                  <summary>Ask for a caption change</summary>
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
                    placeholder="Use Wispr Flow in any language. For example: lead with the featured place, make the caption warmer, and end with a save reminder."
                    rows={2}
                  />
                  <div className="action-row">
                    <p className="hint">
                      Updates these captions. Change narration in Audio & Voice;
                      visual edits need your video editor.
                    </p>
                    <button
                      className="secondary"
                      disabled={!revision.trim()}
                      onClick={() => reviseKit()}
                    >
                      Apply my changes
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </details>
                <CreatorDetails
                  value={draft.details}
                  onChange={(details) => patch({ details })}
                />
                {needsRealReview && (
                  <p className="message warning" role="status">
                    Analyze the saved recording to replace unverified captions
                    before publishing. Your current text stays saved until a new
                    kit is ready.
                  </p>
                )}
                <button className="text-button" onClick={() => analyze()}>
                  Analyze my recording again
                </button>
                <div className="section-heading">
                  <h3>Your publishing kit</h3>
                  <button
                    className="quiet"
                    disabled={
                      !activeKit ||
                      (!connections.demo && isPlaceholderKit(activeKit))
                    }
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
                      onChange={(e) => {
                        const language = e.target.value as Language;
                        patch({ kitLanguage: language });
                        if (!draft.kits[language]) generateKit(language);
                      }}
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
                    onClick={() =>
                      shouldReanalyze
                        ? analyze()
                        : generateKit(draft.kitLanguage)
                    }
                  >
                    {activeKit ? "Regenerate captions" : "Generate captions"}
                  </button>
                </div>
                {activeKit &&
                isPlaceholderKit(activeKit) &&
                !connections.demo ? (
                  <p className="message warning">
                    The previous text was a placeholder. Generate a kit from
                    your recording before copying or publishing.
                  </p>
                ) : activeKit ? (
                  <>
                    {activeKit?.sample && (
                      <p className="hint warning">
                        <SampleBadge /> Editable sample wording, not a factual
                        analysis of your recording.
                      </p>
                    )}
                    {activeKit.discovery && (
                      <details className="caption-strategy">
                        <summary>Search phrases & caption strategy</summary>
                        <p>
                          <strong>Primary phrase:</strong>{" "}
                          {activeKit.discovery.primaryKeyword}
                        </p>
                        {activeKit.discovery.supportingKeywords.length > 0 && (
                          <p>
                            <strong>Related phrases:</strong>{" "}
                            {activeKit.discovery.supportingKeywords.join(" · ")}
                          </p>
                        )}
                        {activeKit.discovery.location && (
                          <p>
                            <strong>Featured place:</strong>{" "}
                            {activeKit.discovery.location}
                          </p>
                        )}
                        <p>{activeKit.discovery.searchIntent}</p>
                        <p className="hint">
                          Suggested from your video and brief. Live trends and
                          search volumes haven’t been checked; reach isn’t
                          guaranteed.
                        </p>
                      </details>
                    )}
                    <OutputEditor
                      onRewrite={(field) => reviseKit(field)}
                      kit={{
                        ...activeKit,
                        outputs: activeKit.outputs.filter(
                          (output) =>
                            output.id === "hook" ||
                            (output.id.startsWith("youtube")
                              ? draft.platforms.includes("youtube")
                              : draft.platforms.includes(
                                  output.id as Platform,
                                )),
                        ),
                      }}
                      onCopy={(text) => void copy(text)}
                      onChange={(id, text) =>
                        setDraft((d) => ({
                          ...d,
                          kits: {
                            ...d.kits,
                            [d.kitLanguage]: {
                              ...d.kits[d.kitLanguage]!,
                              discovery: undefined,
                              outputs: d.kits[d.kitLanguage]!.outputs.map(
                                (o) => (o.id === id ? { ...o, text } : o),
                              ),
                            },
                          },
                        }))
                      }
                    />
                  </>
                ) : (
                  <p className="empty-kit">
                    Generate the {draft.kitLanguage} kit to review these
                    captions.
                  </p>
                )}
                <div className="action-row">
                  <button className="quiet" onClick={() => go(3)}>
                    <ArrowLeft size={16} />
                    Back to audio & voice
                  </button>
                  <button
                    className="primary"
                    disabled={!activeKit || !hasOriginal || textInvalid}
                    onClick={() => go(5)}
                  >
                    Review & publish
                    <ArrowRight size={17} />
                  </button>
                </div>
              </section>
            )}
            {draft.step === 5 && (
              <section className="workspace-panel">
                <div className="panel-heading">
                  <div>
                    <h2 ref={headingRef} tabIndex={-1}>
                      {receiptReady
                        ? draft.job?.demo
                          ? "Your demo is complete."
                          : "Your publishing status."
                        : "One reel. Ready to go."}
                    </h2>
                    <p>
                      {receiptReady
                        ? "Follow delivery below. Your video and captions are saved."
                        : "Connect your accounts, choose a time, and confirm."}
                    </p>
                  </div>
                  <Send size={25} className="heading-icon" />
                </div>
                {draft.job?.legacy && (
                  <p className="message warning">
                    This request belongs to an earlier publishing connection.
                    Check its destination accounts before starting another reel
                    or retrying a post.
                  </p>
                )}
                <div className="publish-summary">
                  <div>
                    {preview && (
                      <video
                        crossOrigin="anonymous"
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
                        ? draft.audioLabel || "Edited soundtrack"
                        : "Original audio"}{" "}
                      · {draft.kitLanguage} captions
                    </p>
                    <p>
                      {draft.platforms.map((p) => platformNames[p]).join(" · ")}
                    </p>
                    {receiptReady ? (
                      preview && (
                        <a
                          className="download-link"
                          href={preview}
                          download={draft.fileName || "reelready.mp4"}
                        >
                          <Download size={15} />
                          Download video
                        </a>
                      )
                    ) : (
                      <button className="quiet" onClick={() => go(4)}>
                        Edit video & captions <ArrowLeft size={15} />
                      </button>
                    )}
                  </div>
                </div>
                {!receiptReady && (
                  <>
                    <InlineAccounts
                      state={connections}
                      loaded={connectionLoaded}
                      selected={draft.platforms}
                      locked={!!draft.job}
                      reelId={draft.id}
                      onSelect={(platform) =>
                        patch({ platforms: toggle(draft.platforms, platform) })
                      }
                      refresh={refreshConnections}
                      beforeConnect={async () => {
                        if (cloudAvailable)
                          await responseJSON(
                            await fetch("/api/draft", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ state: draft }),
                            }),
                          );
                      }}
                    />
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
                            {draft.timezone} ·{" "}
                            {formatDate(draft.scheduledLocal)}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="preflight-panel">
                      <h3>Check before publishing</h3>
                      <p className="hint">
                        {connections.demo
                          ? "Demo mode is on. Nothing will be posted."
                          : "Review your connected accounts, video and captions before confirming publication."}
                      </p>
                      <button
                        className="secondary"
                        disabled={!!busy || !finalAsset}
                        onClick={checkBeforePublishing}
                      >
                        Check publishing setup
                      </button>
                      {preflight && (
                        <div role="status">
                          <p>{preflight.demo ? "Demo mode" : "Real mode"}</p>
                          <p>
                            {Object.entries(preflight.connected)
                              .map(
                                ([p, ok]) =>
                                  `${platformNames[p as Platform]}: ${ok ? "connected" : "not connected"}`,
                              )
                              .join(" · ")}
                          </p>
                          {preflight.blockers.map((v, i) => (
                            <p className="message error" key={`b${i}`}>
                              {v}
                            </p>
                          ))}
                          {!!preflight.warnings.length && (
                            <details className="preflight-warnings">
                              <summary>
                                {preflight.demo
                                  ? "Checks for real publishing"
                                  : "Warnings to review"}{" "}
                                ({preflight.warnings.length})
                              </summary>
                              {preflight.warnings.map((v, i) => (
                                <p className="hint warning" key={`w${i}`}>
                                  {v}
                                </p>
                              ))}
                            </details>
                          )}
                          <p className="hint">
                            Caption checks: Instagram{" "}
                            {preflight.captions.instagramHashtags}/
                            {preflight.captions.instagramHashtagLimit} hashtags
                            · YouTube title{" "}
                            {preflight.captions.youtubeTitleCharacters}
                            /100 · X {preflight.captions.xCharacters}/280
                          </p>
                          {!preflight.blockers.length && (
                            <p>
                              Ready for{" "}
                              {preflight.demo
                                ? "a demo send"
                                : "your final confirmation"}
                              .
                            </p>
                          )}
                          <p className="hint">
                            Local activity: {preflight.usage.uploadsThisMonth}{" "}
                            published uploads this month ·{" "}
                            {preflight.usage.xPostsToday} X posts today.
                            Platform allowances vary by account.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}
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
                {!receiptReady && (
                  <p className="privacy-note">
                    This sends the selected video and captions to the checked
                    social accounts through your publishing connection.
                    Platforms may need processing time. Scheduling uses the time
                    above, not a prediction of reach.
                  </p>
                )}
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
                          {d.state === "demo"
                            ? "Demo — not posted"
                            : d.state === "pending"
                              ? "Pending"
                              : d.state === "processing"
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
                    {!draft.job.demo &&
                      !draft.job.legacy &&
                      draft.job.status === "failed" &&
                      draft.job.deliveries.some(
                        (d) => d.state === "failed",
                      ) && (
                        <button
                          className="secondary"
                          onClick={() => setRetryConfirm(true)}
                        >
                          Retry failed destinations
                        </button>
                      )}
                    {draft.job.scheduledAt && (
                      <p className="hint">
                        {draft.job.demo ? "Demo schedule for" : "Scheduled for"}{" "}
                        {formatDate(draft.job.scheduledAt)}. Refresh delivery
                        after that time to confirm publication.
                      </p>
                    )}
                    <p className="hint">
                      The receipt is saved privately in your workspace. Avoid
                      sending again while delivery is processing.
                    </p>
                  </div>
                )}
                {draft.job && (
                  <p className="hint warning">
                    If YouTube shows this video as private, check the channel’s
                    upload settings.
                  </p>
                )}
                {receiptReady ? (
                  <div className="action-row end">
                    <button className="primary" onClick={reset}>
                      Start a new reel <ArrowRight size={17} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="action-row">
                      <button className="quiet" onClick={() => go(4)}>
                        <ArrowLeft size={16} />
                        Back to review
                      </button>
                      <button
                        className="primary"
                        disabled={
                          needsRealReview ||
                          !allConnected ||
                          !draft.platforms.length ||
                          (!finalVideo && !finalAsset) ||
                          !activeKit ||
                          textInvalid ||
                          (!!draft.job && draft.job.status !== "pending")
                        }
                        onClick={() => setPublishConfirm(true)}
                      >
                        {draft.timing === "schedule"
                          ? "Schedule on selected platforms"
                          : "Publish on selected platforms"}
                        <Send size={16} />
                      </button>
                    </div>
                  </>
                )}
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
          <div className="flow-footer">
            <details className="voice-tips">
              <summary>Using Wispr Flow?</summary>
              <p>
                Click any text box, hold your Wispr key and speak. Choose your
                languages in Wispr, add niche words to its Dictionary, and save
                recurring text as Snippets. Command Mode can refine selected
                text. Wispr runs separately; typing always works.
              </p>
            </details>
          </div>
        </main>
        <ConfirmDialog
          open={retryConfirm}
          title="Retry failed destinations?"
          description={`This checks the latest status and retries only failed destinations: ${draft.job?.deliveries
            .filter((d) => d.state === "failed")
            .map((d) => platformNames[d.platform as Platform])
            .join(
              ", ",
            )}. Successful posts are kept, and the original media is reused.`}
          confirmLabel="Confirm retry"
          onCancel={() => setRetryConfirm(false)}
          onConfirm={retryFailed}
        />
        <ConfirmDialog
          open={publishConfirm}
          title={
            connections.demo
              ? "Simulate this publication?"
              : "Publish this reel?"
          }
          description={`${connections.demo ? "Demo mode: nothing will be posted. " : ""}${draft.timing === "schedule" ? "At your planned time" : "Publish now"} to ${draft.platforms.map((p) => `${platformNames[p]}${connections.accounts[p]?.name ? ` (${connections.accounts[p]!.name})` : ""}`).join(", ")}. Review the video and captions before confirming.`}
          confirmLabel={
            connections.demo
              ? "Confirm demo publication"
              : draft.timing === "schedule"
                ? "Confirm schedule"
                : "Confirm publish"
          }
          onCancel={() => setPublishConfirm(false)}
          onConfirm={publish}
        />
      </div>
    </WorkspaceShell>
  );
}
