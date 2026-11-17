import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProxyEntry } from "./proxy-pool.js";
import type { ProviderDef } from "./types.js";

export interface ProviderState {
  enabled: boolean;
  receive?: boolean;
  values: Record<string, string>;
}

export interface StoredConfig {
  version: 1;
  mcpToken: string;
  admin?: { salt: string; hash: string };
  sessionSecret: string;
  sessionEpoch: number;
  providers: Record<string, ProviderState>;
  dibarouter?: DibaRouterStored;
  settings?: AppSettingsStored;
  profile?: ProfileStored;
  proxyPool?: ProxyPoolStored;
}

export interface ProxyPoolStored {
  auto: boolean;
  activeId?: string;
  entries: ProxyEntry[];
}

export interface ProfileStored {
  ownerName?: string;
  orgName?: string;
  description?: string;
  website?: string;
  logo?: string;
  installedAt?: string;
}

export const PROFILE_TEXT_FIELDS = ["ownerName", "orgName", "description", "website"] as const;

export type AppProxyType = "none" | "http" | "socks5";

export interface AppSettingsStored {
  proxyType?: AppProxyType;
  proxyUrl?: string;
  logRetentionDays?: number;
  mcpWriteLimit?: number;
}

export function readStoredSettings(dataDir: string): AppSettingsStored {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
    return parsed?.settings ?? {};
  } catch {
    return {};
  }
}

export function dockerizeLocalProxy(value: string): string {
  if (process.env.DOCKER_CONTAINER !== "1" || !value) return value;
  return value.replace(
    /(\/\/(?:[^@/\s]*@)?)(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(?=[:/]|$)/i,
    (_match, prefix: string) => `${prefix}host.docker.internal`,
  );
}

export function proxyEnvOf(settings: AppSettingsStored): Record<string, string> {
  if (settings.proxyType === "socks5" && settings.proxyUrl) return { SOCKS_PROXY: dockerizeLocalProxy(settings.proxyUrl) };
  if (settings.proxyType === "http" && settings.proxyUrl) return { HTTPS_PROXY: dockerizeLocalProxy(settings.proxyUrl) };
  return {};
}

export interface DibaRouterStored {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export const DIBAROUTER_DEFAULT_BASE = "https://dibarouter.ir/api/v1";
export const DIBAROUTER_DEFAULT_MODEL = "dibachain/diba-router-free";

export function envKey(providerId: string, fieldKey: string): string {
  const snake = fieldKey.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return `${providerId}_${snake}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export class ConfigStore {
  private data: StoredConfig;
  private file: string;

  constructor(private dataDir: string, private env: NodeJS.ProcessEnv = process.env) {
    this.file = join(dataDir, "config.json");
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.data = this.load();
  }

  get dir(): string {
    return this.dataDir;
  }

  private load(): StoredConfig {
    const defaults = (): StoredConfig => ({
      version: 1,
      mcpToken: newToken(),
      sessionSecret: randomBytes(32).toString("base64url"),
      sessionEpoch: 0,
      providers: {},
    });
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, "utf8"));
        const merged: StoredConfig = { ...defaults(), ...parsed };
        if (!merged.mcpToken) merged.mcpToken = newToken();
        if (!parsed.sessionSecret || !parsed.mcpToken) {
          this.data = merged;
          this.persist();
        }
        return merged;
      } catch (err) {
        const backup = `${this.file}.corrupt-${Date.now()}`;
        copyFileSync(this.file, backup);
        console.error(`[diba-mcp] config.json خراب بود؛ نسخه‌ی خراب در ${backup} ذخیره شد و فایل تازه ساخته شد`, err);
      }
    }
    this.data = defaults();
    this.persist();
    return this.data;
  }

  private persist() {
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  get mcpToken(): string {
    return this.env.MCP_TOKEN || this.data.mcpToken;
  }
  get mcpTokenFromEnv(): boolean {
    return Boolean(this.env.MCP_TOKEN);
  }
  rotateMcpToken(): string {
    this.data.mcpToken = newToken();
    this.persist();
    return this.data.mcpToken;
  }

  get admin() {
    return this.data.admin;
  }
  setAdmin(admin: { salt: string; hash: string }) {
    this.data.admin = admin;
    this.data.sessionEpoch++;
    this.persist();
  }

  clearAdmin() {
    delete this.data.admin;
    this.data.sessionEpoch++;
    this.persist();
  }

  get sessionSecret(): string {
    return this.data.sessionSecret;
  }
  get sessionEpoch(): number {
    return this.data.sessionEpoch;
  }
  bumpSessionEpoch() {
    this.data.sessionEpoch++;
    this.persist();
  }

  dibarouter() {
    const saved = this.data.dibarouter ?? {};
    const baseUrl = (this.env.DIBAROUTER_BASE_URL || saved.baseUrl || DIBAROUTER_DEFAULT_BASE).trim().replace(/\/+$/, "");
    return {
      baseUrl,
      apiKey: this.env.DIBAROUTER_API_KEY || saved.apiKey || "",
      model: this.env.DIBAROUTER_MODEL || saved.model || DIBAROUTER_DEFAULT_MODEL,
      apiKeyFromEnv: Boolean(this.env.DIBAROUTER_API_KEY),
      baseUrlFromEnv: Boolean(this.env.DIBAROUTER_BASE_URL),
      modelFromEnv: Boolean(this.env.DIBAROUTER_MODEL),
    };
  }

  updateDibarouter(patch: { baseUrl?: string; apiKey?: string; model?: string }) {
    const cur = this.data.dibarouter ?? {};
    const next: DibaRouterStored = { ...cur };
    if (patch.baseUrl !== undefined) {
      const value = patch.baseUrl.trim().replace(/\/+$/, "");
      if (value) next.baseUrl = value;
      else delete next.baseUrl;
    }
    if (patch.apiKey !== undefined) {
      const value = patch.apiKey.trim();
      if (value) next.apiKey = value;
      else delete next.apiKey;
    }
    if (patch.model !== undefined) {
      const value = patch.model.trim();
      if (value) next.model = value;
      else delete next.model;
    }
    this.data.dibarouter = next;
    this.persist();
    return this.dibarouter();
  }

  settings() {
    const saved = this.data.settings ?? {};
    const envSocks = this.env.SOCKS_PROXY || this.env.socks_proxy;
    const envHttp = this.env.HTTPS_PROXY || this.env.https_proxy || this.env.HTTP_PROXY || this.env.http_proxy;
    const proxyFromEnv = Boolean(envSocks || envHttp);
    return {
      proxyType: saved.proxyType ?? (envSocks ? "socks5" : envHttp ? "http" : "none"),
      proxyUrl: saved.proxyUrl ?? envSocks ?? envHttp ?? "",
      proxyFromEnv,
      logRetentionDays: Number(this.env.LOG_RETENTION_DAYS) || saved.logRetentionDays || 14,
      mcpWriteLimit: Number(this.env.MCP_WRITE_LIMIT) || saved.mcpWriteLimit || 30,
      logRetentionFromEnv: Boolean(this.env.LOG_RETENTION_DAYS),
      mcpWriteLimitFromEnv: Boolean(this.env.MCP_WRITE_LIMIT),
    };
  }

  updateSettings(patch: AppSettingsStored) {
    const cur = this.data.settings ?? {};
    const next: AppSettingsStored = { ...cur };
    if (patch.proxyType !== undefined) {
      if (patch.proxyType === "none") {
        next.proxyType = "none";
        delete next.proxyUrl;
      } else {
        next.proxyType = patch.proxyType;
      }
    }
    if (patch.proxyUrl !== undefined) {
      const value = patch.proxyUrl.trim();
      if (value) next.proxyUrl = value;
      else delete next.proxyUrl;
    }
    if (patch.logRetentionDays !== undefined) next.logRetentionDays = patch.logRetentionDays;
    if (patch.mcpWriteLimit !== undefined) next.mcpWriteLimit = patch.mcpWriteLimit;
    this.data.settings = next;
    this.persist();
    return this.settings();
  }

  proxyPool(): ProxyPoolStored {
    const pool = this.data.proxyPool;
    return { auto: Boolean(pool?.auto), activeId: pool?.activeId, entries: Array.isArray(pool?.entries) ? pool.entries : [] };
  }

  saveProxyPool(pool: ProxyPoolStored) {
    this.data.proxyPool = { auto: pool.auto, activeId: pool.activeId, entries: pool.entries };
    if (!pool.activeId) delete this.data.proxyPool.activeId;
    this.persist();
    return this.proxyPool();
  }

  profile() {
    const p = this.data.profile ?? {};
    return {
      ownerName: p.ownerName ?? "",
      orgName: p.orgName ?? "",
      description: p.description ?? "",
      website: p.website ?? "",
      logo: p.logo ?? "",
      installedAt: p.installedAt ?? "",
      installed: Boolean(p.installedAt),
    };
  }

  get needsInstall(): boolean {
    return !this.data.profile?.installedAt;
  }

  updateProfile(patch: Partial<Pick<ProfileStored, (typeof PROFILE_TEXT_FIELDS)[number] | "logo">>) {
    const next: ProfileStored = { ...(this.data.profile ?? {}) };
    for (const key of [...PROFILE_TEXT_FIELDS, "logo"] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      if (value) next[key] = value;
      else delete next[key];
    }
    this.data.profile = next;
    this.persist();
    return this.profile();
  }

  markInstalled() {
    this.data.profile = { ...(this.data.profile ?? {}), installedAt: new Date().toISOString() };
    this.persist();
    return this.profile();
  }

  state(id: string): ProviderState {
    return this.data.providers[id] ?? { enabled: false, values: {} };
  }

  resolve(def: ProviderDef): { values: Record<string, string>; fromEnv: Record<string, boolean> } {
    const st = this.state(def.id);
    const values: Record<string, string> = {};
    const fromEnv: Record<string, boolean> = {};
    for (const f of def.fields) {
      const e = this.env[envKey(def.id, f.key)];
      if (e) {
        values[f.key] = e;
        fromEnv[f.key] = true;
      } else {
        values[f.key] = st.values[f.key] || f.default || "";
        fromEnv[f.key] = false;
      }
    }
    return { values, fromEnv };
  }

  isReceiving(def: ProviderDef): boolean {
    const envFlag = this.env[`${def.id.toUpperCase()}_RECEIVE`];
    if (envFlag !== undefined) return envFlag === "true" || envFlag === "1";
    return Boolean(this.state(def.id).receive);
  }
  receiveFromEnv(def: ProviderDef): boolean {
    return this.env[`${def.id.toUpperCase()}_RECEIVE`] !== undefined;
  }

  isEnabled(def: ProviderDef): boolean {
    const envFlag = this.env[`${def.id.toUpperCase()}_ENABLED`];
    if (envFlag !== undefined) return envFlag === "true" || envFlag === "1";
    return this.state(def.id).enabled;
  }

  enabledFromEnv(def: ProviderDef): boolean {
    return this.env[`${def.id.toUpperCase()}_ENABLED`] !== undefined;
  }

  missingFields(def: ProviderDef): string[] {
    const { values } = this.resolve(def);
    return def.fields.filter((f) => f.required && !values[f.key]).map((f) => f.key);
  }

  isReady(def: ProviderDef): boolean {
    return this.isEnabled(def) && this.missingFields(def).length === 0;
  }

  update(id: string, patch: { enabled?: boolean; receive?: boolean; values?: Record<string, string> }) {
    const cur = this.state(id);
    const next: ProviderState = {
      enabled: patch.enabled ?? cur.enabled,
      receive: patch.receive ?? cur.receive,
      values: { ...cur.values },
    };
    for (const [k, v] of Object.entries(patch.values ?? {})) {
      if (v === "") delete next.values[k];
      else next.values[k] = v.trim();
    }
    this.data.providers[id] = next;
    this.persist();
  }
}

export function newToken(): string {
  return "dmcp_" + randomBytes(24).toString("base64url");
}
