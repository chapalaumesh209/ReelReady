"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Circle,
  CircleDot,
  Download,
  LoaderCircle,
} from "lucide-react";
import { AutoTextarea } from "./index";
import {
  defaultSettings,
  type AudioState,
  type AudioSettings,
  type Edit,
  type MediaAsset,
  type MediaInfo,
  type MediaJob,
} from "@/lib/audio/schema";
import type { StoredVideo } from "@/lib/supabase";
import {
  browserRequest as request,
  BrowserRequestError,
} from "@/lib/browser-request";

type LinkedAsset = {
  id: string;
  url: string;
  stored: StoredVideo;
  metadata: Partial<MediaInfo>;
};
type Snapshot = {
  state: AudioState;
  assets: MediaAsset[];
  workerReady: boolean;
  speechReady: boolean;
  transcriptionReady: boolean;
  speechUnavailableReason?: string;
};
type Choice = "original" | "english" | "saved";
function friendlyAudioError(message: string) {
  return /too long for its time slot|segment extends beyond the video/i.test(
    message,
  )
    ? "The narration is longer than your video. Shorten your words, then create the English version again. No words were cut; your original is safe."
    : message;
}
const active = (job: MediaJob | null) =>
  !!job && ["queued", "running"].includes(job.status);
export function AudioEditor({
  reelId,
  token,
  originalURL,
  creatorNote = "",
  onBack,
  onContinue,
  onPending,
  onReady,
}: {
  reelId: string;
  token: string;
  originalURL: string;
  creatorNote?: string;
  onBack: () => void;
  onContinue: (variant?: "original") => void;
  onPending: () => void;
  onReady: (
    asset: StoredVideo,
    original: boolean,
    label: string,
    meta: Partial<MediaInfo>,
  ) => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [job, setJob] = useState<MediaJob | null>(null);
  const [choice, setChoice] = useState<Choice>("original");
  const [words, setWords] = useState("");
  const [voiceProfile, setVoiceProfile] = useState<
    NonNullable<AudioSettings["voiceProfile"]>
  >({ gender: "natural", accent: "en-US" });
  const [delivery, setDelivery] = useState<AudioSettings["style"]>("Natural");
  const profileRef = useRef(voiceProfile),
    deliveryRef = useRef(delivery);
  const [final, setFinal] = useState<LinkedAsset | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [now, setNow] = useState(0);
  const mounted = useRef(true),
    operation = useRef(false),
    dirtyRef = useRef(false),
    wordsRef = useRef("");
  const snapshotRef = useRef<Snapshot | null>(null),
    choiceRef = useRef<Choice>("original");
  const callbacks = useRef({ onReady, onContinue, onPending });
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const heading = useRef<HTMLHeadingElement>(null);
  const inputRevision = useRef(0);
  const creationRequest = useRef<string | null>(null);
  const pollingInterrupted = useRef(false);
  useEffect(() => {
    callbacks.current = { onReady, onContinue, onPending };
  }, [onReady, onContinue, onPending]);
  function choose(next: Choice) {
    choiceRef.current = next;
    setChoice(next);
    setError("");
    setNotice("");
    if (next === "original")
      requestAnimationFrame(() => heading.current?.focus());
  }
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const next = await request<Snapshot>(
        `/api/audio?reelId=${reelId}`,
        undefined,
        signal,
      );
      if (!mounted.current) return next;
      snapshotRef.current = next;
      setSnapshot(next);
      if (!dirtyRef.current) {
        const text =
          next.state.settings.creatorInstructions ??
          (next.state.settings.durationMode
            ? ""
            : creatorNote || next.state.script);
        const profile = next.state.settings.voiceProfile || {
          gender: "natural" as const,
          accent: "en-US" as const,
        };
        profileRef.current = profile;
        setVoiceProfile(profile);
        const style =
          next.state.settings.durationMode || next.state.settings.voiceProfile
            ? next.state.settings.style
            : "Natural";
        deliveryRef.current = style;
        setDelivery(style);
        wordsRef.current = text;
        setWords(text);
      }
      if (
        next.state.rendered_id &&
        next.state.approved_hash &&
        !dirtyRef.current
      ) {
        const asset = await request<LinkedAsset>(
          `/api/media/assets?id=${next.state.rendered_id}`,
          undefined,
          signal,
        );
        if (mounted.current) {
          setFinal(asset);
          callbacks.current.onReady(
            asset.stored,
            asset.id === next.state.source_id,
            asset.id === next.state.source_id
              ? "Keep original audio"
              : "Saved audio version",
            asset.metadata,
          );
        }
      }
      return next;
    },
    [reelId, creatorNote],
  );
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    (async () => {
      setBusy("Opening your recording…");
      setNow(Date.now());
      try {
        const state = await request<AudioState>(
          "/api/audio",
          { action: "init", reelId, token },
          abort.signal,
        );
        const next = await refresh(abort.signal);
        const { jobs } = await request<{ jobs: MediaJob[] }>(
          `/api/media/jobs?reelId=${reelId}`,
          undefined,
          abort.signal,
        );
        if (!mounted.current) return;
        const pending = jobs.find(
          (j) => j.source_id === state.source_id && active(j),
        );
        if (pending) {
          setJob(pending);
          if (pending.kind !== "analyze") choose("english");
        } else if (
          state.rendered_id &&
          state.rendered_id !== state.source_id &&
          state.approved_hash
        ) {
          // Keep existing custom renders usable without exposing their old editing controls.
          choose("saved");
        } else {
          const failed = jobs.find(
            (j) =>
              j.source_id === state.source_id &&
              j.kind === "english" &&
              j.status === "failed",
          );
          if (failed) {
            setJob(failed);
            choose("english");
            if (!next.speechUnavailableReason)
              setError(
                friendlyAudioError(
                  failed.safe_error ||
                    "The English version could not finish. Your original and words are safe.",
                ),
              );
          }
        }
        const source = next.assets.find((a) => a.id === state.source_id);
        if (!pending && next.workerReady && !source?.metadata.decoded)
          setJob(
            await request<MediaJob>(
              "/api/media/analyze",
              { reelId, sourceId: state.source_id },
              abort.signal,
            ),
          );
      } catch (e) {
        if (!abort.signal.aborted && mounted.current)
          setError((e as Error).message);
      } finally {
        if (mounted.current) setBusy("");
      }
    })();
    return () => {
      mounted.current = false;
      abort.abort();
    };
  }, [reelId, token, refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      void request<{ status: string }>("/api/media/worker-status")
        .then((result) => {
          if (mounted.current)
            setSnapshot((current) =>
              current
                ? { ...current, workerReady: result.status === "online" }
                : current,
            );
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, []);
  const jobId = job?.id,
    jobStatus = job?.status;
  useEffect(() => {
    if (!jobId || !["queued", "running"].includes(jobStatus || "")) return;
    const abort = new AbortController();
    let checking = false;
    const timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const next = await request<MediaJob>(
          `/api/media/jobs?id=${jobId}`,
          undefined,
          abort.signal,
        );
        if (abort.signal.aborted) return;
        if (pollingInterrupted.current) {
          pollingInterrupted.current = false;
          setNotice("");
        }
        if (next.status === "failed") {
          setError(
            friendlyAudioError(
              next.safe_error ||
                "The English version could not finish. Your original video is safe.",
            ),
          );
          const state = await refresh(abort.signal);
          if (state.speechUnavailableReason) setError("");
        }
        if (next.status === "completed") {
          const state = await refresh(abort.signal);
          if (abort.signal.aborted) return;
          if (next.result?.applied === false)
            setNotice(
              "Your newer edits were kept. Create the English version again when ready.",
            );
          else if (next.kind !== "analyze") {
            setEditing(false);
            setNotice(
              state.state.approved_hash
                ? "Your video is ready. Play it before continuing."
                : "Your saved script is ready. Create the English video to continue.",
            );
          }
        }
        if (!abort.signal.aborted) setJob(next);
      } catch (e) {
        if (!abort.signal.aborted && mounted.current) {
          if (
            e instanceof BrowserRequestError &&
            [0, 408, 502, 503, 504].includes(e.status)
          ) {
            pollingInterrupted.current = true;
            setNotice(
              "Reconnecting to your voiceover… Processing can continue in the background. Your original and words are safe.",
            );
          } else setError((e as Error).message);
        }
      } finally {
        checking = false;
      }
    }, 1500);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [jobId, jobStatus, refresh]);

  // Serialize saves: an older autosave must never replace a newer script or a render.
  function saveWords() {
    const revision = inputRevision.current,
      text = wordsRef.current;
    const state = snapshotRef.current?.state;
    if (!state)
      return Promise.reject(new Error("Wait for your recording to open."));
    const changedWords = text !== (state.settings.creatorInstructions ?? "");
    const changedVoice =
      JSON.stringify(profileRef.current) !==
        JSON.stringify(state.settings.voiceProfile) ||
      deliveryRef.current !== state.settings.style;
    const edit: Edit = {
      settings: {
        ...defaultSettings(),
        ...state.settings,
        mode: "voiceover",
        targetLanguage: "English",
        originalVolume: 0,
        ducking: false,
        fade: 0.2,
        timing: "preserve",
        durationMode: "fit-video",
        creatorInstructions: text,
        voiceProfile: profileRef.current,
        style: deliveryRef.current,
      },
      script: changedWords ? "" : state.script,
      transcript: state.transcript,
      classification: state.classification,
      segments: changedWords
        ? []
        : changedVoice
          ? state.segments.map((segment) => ({
              ...segment,
              assetId: null,
              duration: null,
              fingerprint: "",
            }))
          : state.segments,
    };
    const next = saveChain.current
      .catch(() => {})
      .then(() =>
        request<AudioState>("/api/audio", {
          action: "save",
          reelId,
          sourceId: state.source_id,
          edit,
        }),
      );
    saveChain.current = next;
    return next.then((saved) => {
      if (mounted.current) {
        snapshotRef.current = snapshotRef.current && {
          ...snapshotRef.current,
          state: saved,
        };
        setSnapshot((current) => current && { ...current, state: saved });
        if (inputRevision.current === revision) {
          dirtyRef.current = false;
          setDirty(false);
        }
      }
      return saved;
    });
  }
  useEffect(() => {
    if (!dirty || busy || active(job)) return;
    const timer = setTimeout(
      () =>
        void saveWords().catch((e) => {
          if (mounted.current) setError(e.message);
        }),
      900,
    );
    return () => clearTimeout(timer);
    // Ref-based serialized saving preserves the most recent dictated text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, words, busy, jobStatus, voiceProfile, delivery]);
  useEffect(() => {
    if (choice === "english" && editing && !busy) {
      const input = document.getElementById("voiceover-words");
      input?.focus();
    }
  }, [choice, editing, busy]);
  function changeWords(text: string) {
    creationRequest.current = null;
    wordsRef.current = text;
    inputRevision.current++;
    dirtyRef.current = true;
    setDirty(true);
    setWords(text);
    setFinal(null);
    callbacks.current.onPending();
    setError("");
  }
  function changeVoice(profile: typeof voiceProfile, style: typeof delivery) {
    creationRequest.current = null;
    profileRef.current = profile;
    deliveryRef.current = style;
    setVoiceProfile(profile);
    setDelivery(style);
    inputRevision.current++;
    dirtyRef.current = true;
    setDirty(true);
    setFinal(null);
    callbacks.current.onPending();
    setError("");
  }
  async function createEnglish(retry = false) {
    if (operation.current || !snapshot || active(job)) return;
    operation.current = true;
    setBusy("Preparing your English version…");
    setError("");
    setNotice("");
    callbacks.current.onPending();
    try {
      // Retrying unchanged choices must not discard already-generated segments.
      await saveChain.current.catch(() => {});
      const current = snapshotRef.current!.state;
      const state =
        dirtyRef.current || current.settings.durationMode !== "fit-video"
          ? await saveWords()
          : current;
      creationRequest.current ||= crypto.randomUUID();
      const next = await request<MediaJob>(
        "/api/media/english",
        {
          reelId,
          sourceId: state.source_id,
          confirmed: true,
          retry,
          requestId: creationRequest.current,
        },
        undefined,
        { idempotent: true },
      );
      creationRequest.current = null;
      if (!mounted.current) return;
      setJob(next);
      if (next.status === "failed") {
        setError(
          friendlyAudioError(
            next.safe_error ||
              "The English version could not finish. Your words and original are safe.",
          ),
        );
        await refresh();
      }
      if (next.status === "completed") {
        await refresh();
        setEditing(false);
        setNotice("Your video is ready. Play it before continuing.");
      }
    } catch (e) {
      if (e instanceof BrowserRequestError && e.status > 0 && e.status < 500)
        creationRequest.current = null;
      if (mounted.current) {
        setError((e as Error).message);
        if (
          e instanceof BrowserRequestError &&
          e.code === "SPEECH_PROVIDER_LIMIT"
        )
          await refresh().catch(() => {});
      }
    } finally {
      operation.current = false;
      if (mounted.current) setBusy("");
    }
  }
  async function continueOriginal() {
    if (operation.current || !snapshot) return;
    operation.current = true;
    setBusy("Keeping your original audio…");
    setError("");
    try {
      await saveChain.current.catch(() => {});
      const state = await request<AudioState>("/api/audio", {
        action: "original",
        reelId,
        sourceId: snapshot.state.source_id,
      });
      if (!mounted.current) return;
      dirtyRef.current = false;
      setDirty(false);
      setJob(null);
      snapshotRef.current = { ...snapshot, state };
      await refresh();
      callbacks.current.onContinue("original");
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy("");
    }
  }
  async function cancelJob() {
    if (!job || operation.current) return;
    operation.current = true;
    setBusy("Stopping audio processing…");
    setError("");
    try {
      await request("/api/media/jobs", { id: job.id });
      await refresh();
      setJob(null);
      choose("original");
      setNotice("Job cancelled. Your sources are unchanged.");
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy("");
    }
  }
  async function back() {
    if (operation.current) return;
    operation.current = true;
    setBusy("Saving your words…");
    try {
      if (dirtyRef.current) await saveWords();
      else await saveChain.current.catch(() => {});
      onBack();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy("");
    }
  }
  if (!snapshot)
    return (
      <section className="workspace-panel">
        <h2>Audio & Voice</h2>
        <p role="status">{busy || "Opening your recording…"}</p>
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
        <button className="quiet" onClick={onBack}>
          Back to upload
        </button>
      </section>
    );
  const source = snapshot.assets.find((a) => a.id === snapshot.state.source_id),
    info = source?.metadata;
  const processing = active(job) && job?.kind !== "analyze";
  const stale =
    active(job) &&
    now - Date.parse(job!.created_at || job!.updated_at) > 180000;
  const validFinal =
    !!final &&
    final.id !== snapshot.state.source_id &&
    snapshot.state.rendered_id === final.id &&
    !!snapshot.state.approved_hash &&
    !dirty;
  const selectedFinal = choice !== "original" && validFinal;
  const unavailable = !snapshot.workerReady || !snapshot.speechReady;
  const readyToCreate =
    !unavailable &&
    !!info?.decoded &&
    !busy &&
    !active(job) &&
    (!!words.trim() || (!!info.hasAudio && snapshot.transcriptionReady));
  return (
    <section className="workspace-panel audio-workspace audio-simple">
      <div className="panel-heading">
        <div>
          <h2 ref={heading} tabIndex={-1}>
            {choice === "original"
              ? "How should your reel sound?"
              : processing
                ? "Creating your English video…"
                : selectedFinal && !editing
                  ? "Listen before you continue."
                  : "Create an English voiceover."}
          </h2>
          <p>
            {choice === "original"
              ? "Keep your audio, or give it an English voiceover."
              : selectedFinal && !editing
                ? "Your finished video is ready to review."
                : "Your words, in English. Your visuals stay the same."}
          </p>
        </div>
      </div>
      {!snapshot.workerReady && (
        <p className="message warning" role="status">
          Audio processing is unavailable right now. Keep your original audio
          and continue.
        </p>
      )}
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="message notice" role="status">
          {notice}
        </p>
      )}
      {choice === "original" && (
        <fieldset className="sound-choices" disabled={!!busy || !!processing}>
          <legend className="sr-only">Choose your audio</legend>
          <button
            type="button"
            className="sound-choice is-selected"
            aria-pressed="true"
            onClick={() => choose("original")}
          >
            <CircleDot size={18} aria-hidden="true" />
            <span>
              <strong>Keep original audio</strong>
              <small>Use your recording just as it is.</small>
            </span>
          </button>
          <button
            type="button"
            className="sound-choice"
            disabled={!snapshot.workerReady}
            onClick={() => {
              choose("english");
              setEditing(true);
            }}
          >
            <Circle size={18} aria-hidden="true" />
            <span>
              <strong>English voiceover</strong>
              <small>Add an English narration. Keep the same visuals.</small>
            </span>
          </button>
        </fieldset>
      )}
      {snapshot.workerReady && !snapshot.speechReady && (
        <p className="message warning" role="status">
          {snapshot.speechUnavailableReason ||
            "English voiceover isn’t available right now. Your original audio still works."}
        </p>
      )}
      {choice === "english" && !processing && (!selectedFinal || editing) && (
        <div className="voiceover-script">
          <label className="field-label" htmlFor="voiceover-words">
            What would you like to change or add?
          </label>
          <p id="voiceover-help" className="hint">
            We use your reel and its original speech. Add changes or extra
            details in any language, or leave this empty.
          </p>
          <AutoTextarea
            id="voiceover-words"
            label="Voiceover words"
            value={words}
            onChange={changeWords}
            rows={4}
            maxLength={4000}
            placeholder="Keep the main story, explain the final result, and make the ending friendlier…"
          />
          <p className="hint">
            We combine the source and your changes, then fit English narration
            across the full video. The original soundtrack is replaced.
          </p>
          <div className="voice-preferences">
            <div>
              <label htmlFor="voice-gender">Voice</label>
              <select
                id="voice-gender"
                value={voiceProfile.gender}
                onChange={(event) =>
                  changeVoice(
                    {
                      ...voiceProfile,
                      gender: event.target.value as typeof voiceProfile.gender,
                    },
                    delivery,
                  )
                }
              >
                <option value="natural">Natural (automatic)</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div>
              <label htmlFor="voice-accent">Accent</label>
              <select
                id="voice-accent"
                value={voiceProfile.accent}
                onChange={(event) =>
                  changeVoice(
                    {
                      ...voiceProfile,
                      accent: event.target.value as typeof voiceProfile.accent,
                    },
                    delivery,
                  )
                }
              >
                <option value="en-US">US English</option>
                <option value="en-GB">British English</option>
                <option value="en-IN">Indian English</option>
              </select>
            </div>
            <div>
              <label htmlFor="voice-delivery">Delivery</label>
              <select
                id="voice-delivery"
                value={delivery}
                onChange={(event) =>
                  changeVoice(
                    voiceProfile,
                    event.target.value as typeof delivery,
                  )
                }
              >
                <option value="Natural">Natural</option>
                <option value="Casual">Casual</option>
                <option value="Friendly and conversational">Friendly</option>
                <option value="Clear and professional">Professional</option>
                {![
                  "Natural",
                  "Casual",
                  "Friendly and conversational",
                  "Clear and professional",
                ].includes(delivery) && (
                  <option value={delivery}>{delivery}</option>
                )}
              </select>
            </div>
          </div>
          {!info?.decoded && snapshot.workerReady && (
            <p className="hint" role="status">
              Checking your recording before creating the voiceover…
            </p>
          )}
        </div>
      )}
      {(busy || (active(job) && (choice !== "original" || stale))) && (
        <div className="audio-job" role="status">
          <LoaderCircle size={17} className="spin" />
          <span>
            {busy ||
              (job?.kind === "analyze"
                ? "Checking your recording…"
                : job?.stage || "Creating your English video…")}
          </span>
        </div>
      )}
      {stale && (
        <p className="hint">
          This is taking longer than usual. Your original video is safe.
        </p>
      )}
      {active(job) && (choice !== "original" || stale) && (
        <div className="audio-recovery-actions">
          {stale && (
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() => void continueOriginal()}
            >
              Continue with original audio
            </button>
          )}
          <button
            className="quiet"
            disabled={!!busy}
            onClick={() => void cancelJob()}
          >
            Cancel job
          </button>
        </div>
      )}
      {choice === "original" && (
        <details className="sound-source">
          <summary>Preview original video</summary>
          <div className="sound-preview">
            <video
              crossOrigin="anonymous"
              src={originalURL || undefined}
              controls
              playsInline
              preload="metadata"
              aria-label="Original audio preview"
            />
            <p className="hint">Your original recording stays safe.</p>
          </div>
        </details>
      )}
      {selectedFinal && !editing && (
        <div className="sound-preview">
          <video
            crossOrigin="anonymous"
            src={final!.url}
            controls
            playsInline
            preload="metadata"
            aria-label="Selected audio preview"
          />
          <div>
            <h3>Play your finished video</h3>
            <p className="hint">Listen through once before continuing.</p>
            <a
              className="download-link"
              href={final!.url}
              download="reelready-video.mp4"
            >
              <Download size={15} />
              Download selected video
            </a>
            <button
              className="quiet"
              disabled={!!busy}
              onClick={() => {
                choose("english");
                setEditing(true);
              }}
            >
              Change voice or words
            </button>
          </div>
        </div>
      )}
      {selectedFinal &&
        !editing &&
        snapshot.state.settings.durationMode === "fit-video" && (
          <details className="voice-script-result">
            <summary>
              English narration · fitted to {Math.round(info?.duration || 0)}{" "}
              seconds
            </summary>
            <p>{snapshot.state.script}</p>
          </details>
        )}
      {choice !== "original" && !error && !processing && (
        <button
          className="text-button"
          disabled={!!busy}
          onClick={() => choose("original")}
        >
          Keep original instead
        </button>
      )}
      <div className="action-row">
        <button className="quiet" disabled={!!busy} onClick={() => void back()}>
          <ArrowLeft size={16} />
          Back to upload
        </button>
        {choice === "original" ||
        (choice === "saved" && selectedFinal) ||
        (choice === "english" && selectedFinal && !editing) ? (
          <button
            className="primary"
            disabled={!!busy}
            onClick={() =>
              choice === "original" ? void continueOriginal() : onContinue()
            }
          >
            {selectedFinal && <Check size={16} />}Continue to captions
            <ArrowRight size={17} />
          </button>
        ) : (
          <button
            className="primary"
            disabled={!readyToCreate}
            onClick={() => void createEnglish(job?.status === "failed")}
          >
            {busy || processing
              ? "Creating English video…"
              : "Create English voiceover"}
            <ArrowRight size={17} />
          </button>
        )}
      </div>
      {error && choice !== "original" && (
        <button
          className="text-button original-recovery"
          disabled={!!busy}
          onClick={() => void continueOriginal()}
        >
          Continue with original audio
        </button>
      )}
    </section>
  );
}
