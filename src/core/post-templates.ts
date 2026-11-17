import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface PostTarget {
  provider: string;
  chatId: string;
  title?: string;
  type?: string;
}

export interface PostTemplate {
  id: string;
  name: string;
  text: string;
  providerIds: string[];
  targets: PostTarget[];
  createdAt: string;
  updatedAt: string;
}

export interface PostTemplateInput {
  name: string;
  text: string;
  providerIds: string[];
  targets: PostTarget[];
}

const MAX_TEMPLATES = 100;
const MAX_TARGETS = 200;
const MAX_TEXT = 4096;

function cleanTargets(raw: unknown): PostTarget[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const targets: PostTarget[] = [];
  for (const item of raw) {
    const provider = String((item as any)?.provider ?? "").trim();
    const chatId = String((item as any)?.chatId ?? "").trim();
    if (!provider || !chatId) continue;
    const key = `${provider}:${chatId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      provider,
      chatId,
      title: String((item as any)?.title ?? "").trim().slice(0, 160) || undefined,
      type: String((item as any)?.type ?? "").trim().slice(0, 24) || undefined,
    });
    if (targets.length >= MAX_TARGETS) break;
  }
  return targets;
}

function cleanInput(raw: Partial<PostTemplateInput> | undefined): PostTemplateInput {
  return {
    name: String(raw?.name ?? "").trim().slice(0, 80),
    text: String(raw?.text ?? "").trim().slice(0, MAX_TEXT),
    providerIds: Array.from(new Set((Array.isArray(raw?.providerIds) ? raw!.providerIds : []).map(String).filter(Boolean))).slice(0, 20),
    targets: cleanTargets(raw?.targets),
  };
}

export class PostTemplateStore {
  private file: string;
  private templates: PostTemplate[];

  constructor(private dataDir: string) {
    this.file = join(dataDir, "post-templates.json");
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.templates = this.load();
  }

  private load(): PostTemplate[] {
    try {
      if (!existsSync(this.file)) return [];
      const parsed = JSON.parse(readFileSync(this.file, "utf8"));
      return Array.isArray(parsed?.templates) ? parsed.templates : [];
    } catch {
      return [];
    }
  }

  private save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, templates: this.templates }, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  list(): PostTemplate[] {
    return [...this.templates].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  get(id: string): PostTemplate | undefined {
    return this.templates.find((t) => t.id === id);
  }

  create(raw: Partial<PostTemplateInput>): PostTemplate {
    const input = cleanInput(raw);
    if (!input.name) throw new Error("نام قالب را وارد کنید.");
    if (!input.text) throw new Error("متن پست را وارد کنید.");
    const now = new Date().toISOString();
    const template: PostTemplate = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    this.templates.unshift(template);
    if (this.templates.length > MAX_TEMPLATES) this.templates = this.templates.slice(0, MAX_TEMPLATES);
    this.save();
    return template;
  }

  update(id: string, raw: Partial<PostTemplateInput>): PostTemplate {
    const index = this.templates.findIndex((t) => t.id === id);
    if (index < 0) throw new Error("قالب پیدا نشد.");
    const existing = this.templates[index];
    const input = cleanInput({ ...existing, ...raw });
    if (!input.name) throw new Error("نام قالب را وارد کنید.");
    if (!input.text) throw new Error("متن پست را وارد کنید.");
    const updated: PostTemplate = {
      ...existing,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    this.templates[index] = updated;
    this.save();
    return updated;
  }

  remove(id: string) {
    const next = this.templates.filter((t) => t.id !== id);
    if (next.length === this.templates.length) throw new Error("قالب پیدا نشد.");
    this.templates = next;
    this.save();
  }
}

export const POST_TEXT_MAX = MAX_TEXT;
export const POST_TARGETS_MAX = MAX_TARGETS;
