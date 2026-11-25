"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { askQuestion, type AskState } from "@/app/ask/actions";

const SUGGESTIONS = [
  "How can we improve our rating?",
  "What are the main complaints about check-in, and how do we fix them?",
  "What do guests love most about us?",
  "What changed compared with the previous period?",
  "What should housekeeping focus on this week?",
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
      {pending ? "Reading the reviews…" : "Ask"}
    </button>
  );
}

function Pending() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <p className="text-sm text-ink-2" role="status">
      Looking through the reviews and statistics. This usually takes 10–20 seconds.
    </p>
  );
}

export function AskForm() {
  const sp = useSearchParams();
  const [state, action] = useActionState<AskState, FormData>(askQuestion, { error: null, question: "" });
  const [text, setText] = useState(state.question);

  return (
    <form action={action} className="space-y-3 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <label htmlFor="ask-question" className="block text-base font-semibold text-ink">
        What would you like to know?
      </label>
      {/* Current filters travel with the question */}
      {(["p", "range", "from", "to"] as const).map((k) => (
        <input key={k} type="hidden" name={k} value={sp.get(k) ?? ""} />
      ))}
      <textarea
        id="ask-question"
        name="question"
        rows={3}
        maxLength={500}
        required
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. How can we improve our rating at Darling Harbour?"
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-accent"
      />
      <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => setText(s)} className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink">
            {s}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        <span className="text-xs text-ink-3">Uses the hotels and period selected above.</span>
      </div>
      <Pending />
      {state.error && (
        <p role="alert" className="text-sm font-medium text-critical-ink">
          <span aria-hidden>⚠ </span>
          {state.error}
        </p>
      )}
    </form>
  );
}
