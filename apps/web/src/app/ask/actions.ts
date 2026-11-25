"use server";
import { redirect } from "next/navigation";
import { ApiError, postAsk } from "@/lib/api";
import { parseProperties, parseRange } from "@/lib/filters";

export interface AskState {
  error: string | null;
  question: string;
}

/** Sends the question to the API, then opens the answer on its own URL (shareable, in history). */
export async function askQuestion(_prev: AskState, form: FormData): Promise<AskState> {
  const question = String(form.get("question") ?? "").trim();
  if (question.length < 3) return { error: "Please type a question.", question };
  if (question.length > 500) return { error: "Please keep the question under 500 characters.", question };

  const sp = { p: String(form.get("p") ?? ""), range: String(form.get("range") ?? ""), from: String(form.get("from") ?? ""), to: String(form.get("to") ?? "") };
  const { range } = parseRange(sp, "12w");
  let id: string;
  try {
    const res = await postAsk({ question, from: range?.from, to: range?.to, properties: parseProperties(sp) });
    id = res.id;
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : "Something went wrong. Please try again.", question };
  }
  const keep = new URLSearchParams(Object.entries(sp).filter(([, v]) => v));
  keep.set("id", id);
  redirect(`/ask?${keep}`); // outside try: redirect works by throwing
}
