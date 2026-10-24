"use client";
import { AutoTextarea } from "./index";
import type { Details } from "@/lib/reel";
export function CreatorDetails({
  value,
  onChange,
}: {
  value: Details;
  onChange: (next: Details) => void;
}) {
  const fields = [
    {
      key: "voice",
      label: "Two or three past captions",
      placeholder:
        "Paste captions you wrote. Their tone is used as a reference; their claims are not copied.",
      max: 3000,
      rows: 3,
    },
    {
      key: "brand",
      label: "Brand or creator name",
      placeholder: "Names to keep exactly as written",
      max: 150,
      rows: 1,
    },
    {
      key: "audience",
      label: "Who should this reach?",
      placeholder: "For example: busy parents looking for easy breakfast ideas",
      max: 300,
      rows: 2,
    },
    {
      key: "location",
      label: "Place featured in this video",
      placeholder:
        "Exact restaurant, neighbourhood or city — only if this reel features it",
      max: 150,
      rows: 1,
    },
    {
      key: "goal",
      label: "What should viewers do next?",
      placeholder:
        "Save the recipe, discuss a tip, enquire about a service, or visit the featured place",
      max: 180,
      rows: 2,
    },
    {
      key: "keywords",
      label: "Relevant words to include",
      placeholder:
        "Optional product names or search phrases; unrelated terms are omitted",
      max: 500,
      rows: 2,
    },
    { key: "link", label: "Link", placeholder: "https://…", max: 500, rows: 1 },
    {
      key: "disclosure",
      label: "CTA or partnership disclosure",
      placeholder: "Follow for more · #ad only if this is sponsored",
      max: 500,
      rows: 2,
    },
  ] as const;
  return (
    <details className="creator-details">
      <summary>
        Add my details <span>Optional</span>
      </summary>
      <div className="details-body">
        {fields.map((field) => (
          <div key={field.key}>
            <label className="field-label" htmlFor={`creator-${field.key}`}>
              {field.label}
            </label>
            <AutoTextarea
              id={`creator-${field.key}`}
              value={value[field.key] || ""}
              rows={field.rows}
              maxLength={field.max}
              placeholder={field.placeholder}
              onChange={(next) => onChange({ ...value, [field.key]: next })}
            />
          </div>
        ))}
      </div>
    </details>
  );
}
