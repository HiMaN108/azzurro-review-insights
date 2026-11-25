"use client";
import { useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";
const KEY = "theme";
const EVENT = "themechange";

/**
 * Runs in <head> before first paint so the saved theme applies without a flash.
 * Kept as a string because it must execute before React loads.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function read(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system"; // storage blocked (private mode etc.) — follow the device
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb); // other tabs
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function apply(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* still apply for this page view */
  }
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event(EVENT));
}

const OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: "system", label: "Match device", icon: "◐" },
  { value: "light", label: "Light", icon: "☀" },
  { value: "dark", label: "Dark", icon: "☾" },
];

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  return (
    <div role="radiogroup" aria-label="Colour theme" className="flex overflow-hidden rounded-md border border-line bg-surface">
      {OPTIONS.map((o) => {
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.label}
            onClick={() => apply(o.value)}
            className={`flex h-8 items-center gap-1 px-2.5 text-sm transition-colors ${
              active ? "bg-surface-2 font-medium text-ink" : "text-ink-3 hover:text-ink"
            } border-line [&:not(:first-child)]:border-l`}
          >
            <span aria-hidden>{o.icon}</span>
            <span className="sr-only sm:not-sr-only">{o.label === "Match device" ? "Auto" : o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
