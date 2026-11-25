import { PROPERTIES } from "@azzurro/shared";

/** Colour follows the hotel, never its rank: fixed slot per property. */
const SLOT: Record<string, number> = {
  "venus-surry-hills": 1,
  "chateau-de-venus": 2,
  "olympic-paddington": 3,
  "venus-potts-point-sydney": 4,
};

export const propertyColor = (slug: string) => `var(--series-${SLOT[slug] ?? 1})`;
export const PROPERTY_OPTIONS = [...PROPERTIES].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ slug: p.slug, name: p.name }));
export const propertyName = (slug: string) => PROPERTIES.find((p) => p.slug === slug)?.name ?? slug;
