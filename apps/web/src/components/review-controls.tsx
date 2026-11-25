"use client";
import { TOPICS } from "@azzurro/shared";
import { field, useUrlUpdate } from "./filter-bar";

/** Extra filters for the review feed: rating band, topic, keyword search, sort. */
export function ReviewControls() {
  const { sp, update } = useUrlUpdate();
  const q = sp.get("q") ?? "";
  const topicValue = sp.get("topic") ? `${sp.get("topic")}:${sp.get("polarity") ?? ""}` : "";

  return (
    <>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
        Rating
        <select value={sp.get("sentiment") ?? ""} onChange={(e) => update({ sentiment: e.target.value || null })} className={field}>
          <option value="">All ratings</option>
          <option value="POSITIVE">Positive (8–10)</option>
          <option value="NEUTRAL">Mixed (6–7.9)</option>
          <option value="NEGATIVE">Negative (below 6)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
        Topic
        <select
          value={topicValue}
          onChange={(e) => {
            const [topic, polarity] = e.target.value.split(":");
            update({ topic: topic || null, polarity: polarity || null });
          }}
          className={field}
        >
          <option value="">Any topic</option>
          <optgroup label="Complaints about…">
            {TOPICS.map((t) => (
              <option key={`${t.key}-n`} value={`${t.key}:NEGATIVE`}>
                {t.label}: complaints
              </option>
            ))}
          </optgroup>
          <optgroup label="Praise for…">
            {TOPICS.map((t) => (
              <option key={`${t.key}-p`} value={`${t.key}:POSITIVE`}>
                {t.label}: praise
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {/* Uncontrolled input; `key` resets it when the URL's q changes (e.g. "Clear all filters"). */}
      <form
        key={q}
        className="flex flex-col gap-1 text-xs font-medium text-ink-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() || null });
        }}
      >
        <label htmlFor="review-search">Search text</label>
        <div className="flex gap-1">
          <input id="review-search" name="q" type="search" defaultValue={q} placeholder="e.g. towels, aircon" className={`${field} w-44`} />
          <button type="submit" className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink hover:bg-surface-2">
            Search
          </button>
        </div>
      </form>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
        Sort
        <select value={sp.get("sort") ?? "newest"} onChange={(e) => update({ sort: e.target.value === "newest" ? null : e.target.value })} className={field}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="lowest">Lowest score first</option>
          <option value="highest">Highest score first</option>
        </select>
      </label>
    </>
  );
}
