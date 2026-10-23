"use client";
import { useEffect, useRef } from "react";
import { Copy } from "lucide-react";
import { characterCount, hashtagCount, xCount, type Kit } from "@/lib/content";
export function Logo() {
  return (
    <svg
      className="wave-mark"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <rect width="48" height="48" rx="14" fill="#e8dcff" />
      <g stroke="#6843aa" strokeWidth="3.6" strokeLinecap="round">
        <path d="M10.5 20v8M17.5 13v22M24.5 17v14" />
      </g>
      <path d="m32 17 9 7-9 7V17Z" fill="#6843aa" />
    </svg>
  );
}
export function AutoTextarea({
  id,
  label,
  value,
  onChange,
  rows = 3,
  placeholder = "",
  maxLength = 6000,
  onSubmit,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (s: string) => void;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
  onSubmit?: () => void;
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
      className="resize-none"
      id={id}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      onKeyDown={(e) => {
        if (
          onSubmit &&
          e.key === "Enter" &&
          !e.shiftKey &&
          !e.nativeEvent.isComposing &&
          e.keyCode !== 229
        ) {
          e.preventDefault();
          onSubmit();
        }
      }}
      placeholder={placeholder}
      maxLength={maxLength}
    />
  );
}
export function OutputEditor({
  kit,
  onChange,
  onCopy,
}: {
  kit: Kit;
  onChange: (id: string, value: string) => void;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="output-list">
      {kit.outputs.map((o) => {
        const count = o.id === "x" ? xCount(o.text) : characterCount(o.text),
          max =
            o.id === "instagram"
              ? 2200
              : o.id === "youtubeTitle"
                ? 100
                : o.id === "x"
                  ? 280
                  : 5000;
        return (
          <section
            className="output-sheet"
            key={o.id}
            aria-labelledby={`label-${o.id}`}
          >
            <div className="sheet-heading">
              <h3 id={`label-${o.id}`}>{o.title}</h3>
              <button
                type="button"
                className="quiet"
                onClick={() => onCopy(o.text)}
                aria-label={`Copy ${o.title}`}
              >
                <Copy size={15} />
                Copy
              </button>
            </div>
            <AutoTextarea
              id={`output-${o.id}`}
              label={o.title}
              value={o.text}
              onChange={(v) => onChange(o.id, v)}
              maxLength={10000}
            />
            <div className={`count ${count > max ? "invalid" : ""}`}>
              {count.toLocaleString()} / {max.toLocaleString()}
              {o.id === "x" ? " weighted characters" : " characters"}
              {o.id === "instagram"
                ? ` · ${hashtagCount(o.text)} hashtags`
                : ""}
            </div>
            {o.warning && <p className="hint">{o.warning}</p>}
          </section>
        );
      })}
    </div>
  );
}
