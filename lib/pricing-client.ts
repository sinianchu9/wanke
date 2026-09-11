export type ModelPricing = {
  modelCreditsPerSecond: Record<string, number>;
  baseCredits: number;
  minCredits: number;
  resolutionMultiplier: Record<string, number>;
};

export const DEFAULT_PRICING: ModelPricing = {
  modelCreditsPerSecond: {
    "wan3.0": 2,
    "happyhorse-1.1": 1,
    default: 1,
  },
  baseCredits: 0,
  minCredits: 1,
  resolutionMultiplier: {
    "480p": 0.8,
    "720p": 1.0,
    "1080p": 1.0,
    "2k": 1.5,
    "4k": 2.0,
  },
};

let cachedPricing: ModelPricing | null = null;
let fetchPromise: Promise<ModelPricing> | null = null;

export async function fetchModelPricing(): Promise<ModelPricing> {
  if (cachedPricing) return cachedPricing;
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetch("/api/pricing", { cache: "no-store" })
    .then(res => res.json())
    .then(data => {
      if (data?.ok && data?.modelCreditsPerSecond) {
        cachedPricing = {
          modelCreditsPerSecond: data.modelCreditsPerSecond,
          baseCredits: data.baseCredits ?? 0,
          minCredits: data.minCredits ?? 1,
          resolutionMultiplier: data.resolutionMultiplier ?? DEFAULT_PRICING.resolutionMultiplier,
        };
        return cachedPricing;
      }
      return DEFAULT_PRICING;
    })
    .catch(() => DEFAULT_PRICING)
    .finally(() => { fetchPromise = null; });
  return fetchPromise;
}

export function calculateCredits(pricing: ModelPricing | null | undefined, model: string, durationSeconds: number, resolution = "1080P"): number {
  const p = pricing || DEFAULT_PRICING;
  const k = model.toLowerCase();
  let rate = p.modelCreditsPerSecond[model] || p.modelCreditsPerSecond[k];
  if (!rate) {
    if (k.includes("wan")) rate = p.modelCreditsPerSecond["wan3.0"] || 2;
    else if (k.includes("happyhorse")) rate = p.modelCreditsPerSecond["happyhorse-1.1"] || 1;
    else rate = p.modelCreditsPerSecond["default"] || 1;
  }
  const resKey = resolution.toLowerCase();
  const mult = p.resolutionMultiplier[resKey] ?? 1.0;
  const base = p.baseCredits || 0;
  return Math.max(p.minCredits || 1, Math.ceil((base + durationSeconds * rate) * mult));
}

export function getModelUnitRate(pricing: ModelPricing | null | undefined, model: string): number {
  const p = pricing || DEFAULT_PRICING;
  const k = model.toLowerCase();
  if (k.includes("wan")) return p.modelCreditsPerSecond["wan3.0"] ?? 2;
  if (k.includes("happyhorse")) return p.modelCreditsPerSecond["happyhorse-1.1"] ?? 1;
  return p.modelCreditsPerSecond[model] ?? p.modelCreditsPerSecond["default"] ?? 1;
}
