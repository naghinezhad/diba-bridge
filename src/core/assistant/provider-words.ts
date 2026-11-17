import type { DibaMcpEngine } from "../engine.js";
import { providerLabel } from "../memory.js";
import type { ProviderWord } from "./intent.js";
import { cleanText } from "./name-match.js";

const EXTRA_WORDS: Record<string, string[]> = {
  bale_client: ["بله", "bale", "پیام‌رسان بله"],
  eitaa_client: ["ایتا", "ایتایار", "eitaa"],
  rubika_client: ["روبیکا", "rubika"],
  soroush_client: ["سروش", "سروش پلاس", "سروش‌پلاس", "soroush", "splus"],
  telegram_client: ["تلگرام", "telegram", "tg"],
  whatsapp: ["واتس‌اپ", "واتساپ", "واتس اپ", "واتس", "whatsapp", "wa"],
  instagram: ["اینستاگرام", "اینستا", "instagram", "insta", "ig"],
  linkedin: ["لینکدین", "linkedin"],
  x: ["توییتر", "twitter", "ایکس"],
};

export function providerWords(engine: DibaMcpEngine): ProviderWord[] {
  return engine.describeProviders().map((provider) => ({
    id: provider.id,
    words: [
      provider.nameFa,
      provider.name,
      provider.id,
      provider.id.replace(/_client$/, ""),
      ...(EXTRA_WORDS[provider.id] ?? []),
    ].filter(Boolean),
  }));
}

export function normalizeProviderId(engine: DibaMcpEngine, value?: string): string | undefined {
  const raw = cleanText(value ?? "").toLowerCase();
  if (!raw) return undefined;
  const all = providerWords(engine).map((entry) => ({
    id: entry.id,
    words: entry.words.map((word) => cleanText(word).toLowerCase()).filter(Boolean),
  }));
  const exact = all.find((entry) => entry.words.includes(raw));
  if (exact) return exact.id;
  return all.find((entry) => entry.words.some((word) => word.length >= 3 && raw.includes(word)))?.id;
}

export function providerName(engine: DibaMcpEngine, id: string): string {
  return engine.provider(id)?.nameFa ?? providerLabel(id);
}
