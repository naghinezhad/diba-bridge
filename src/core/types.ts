import type { z } from "zod";

export interface ProviderField {
  key: string;
  label: string;
  type: "text" | "secret" | "url" | "boolean";
  required?: boolean;
  placeholder?: string;
  help?: string;
  default?: string;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface IncomingMessage {
  key: string;
  provider: string;
  chatId: string;
  chatTitle?: string;
  chatType: "private" | "group" | "channel" | "unknown";
  messageId: string;
  from?: { id?: string; name?: string; username?: string };
  text?: string;
  kind: "text" | "photo" | "file" | "video" | "voice" | "location" | "button" | "other";
  buttonId?: string;
  date: string;
  direction?: "in" | "out";
  source?: "mcp" | "dashboard" | "account";
  mediaUrl?: string;
}

export interface PollResult {
  messages: IncomingMessage[];
  cursor?: string;
}

export interface ReceiveDef {
  poll: (ctx: ProviderContext, cursor: string | undefined, longPollSec: number) => Promise<PollResult>;
  idleMs?: number;
}

export interface InboxAccess {
  list: (opts?: { chatId?: string; limit?: number }) => IncomingMessage[];
}

export interface ProviderContext {
  config: Record<string, string>;
  dataDir?: string;
  inbox?: InboxAccess;
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: S;
  annotations?: ToolAnnotations;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ProviderContext) => Promise<unknown>;
}

export interface AuthUser {
  id: number;
  name?: string;
  username?: string;
}

export interface AuthStep {
  step: "code" | "password" | "done" | "browser";
  transactionHash?: string;
  user?: AuthUser;
  hint?: string;
  warning?: string;
  pending?: boolean;
  qr?: string;
}

export interface AuthSessionImport {
  title: string;
  hint: string;
  placeholder: string;
  run: (ctx: ProviderContext, raw: string, save: (values: Record<string, string>) => void) => Promise<AuthStep>;
}

export interface AuthBrowserLogin {
  title: string;
  hint: string;
  start: (ctx: ProviderContext) => Promise<{ jobId: string; hint?: string }>;
  status: (ctx: ProviderContext, jobId: string, save: (values: Record<string, string>) => void) => Promise<AuthStep>;
}

export interface ProviderAuthDef {
  title: string;
  description: string;
  phoneField: string;
  sessionField: string;
  codeInput?: boolean;
  qr?: boolean;
  getQr?: (ctx: ProviderContext) => Promise<{ qr?: string; ready?: boolean; error?: string }>;
  sessionImport?: AuthSessionImport;
  browserLogin?: AuthBrowserLogin;
  inputLabel?: string;
  inputPlaceholder?: string;
  startLabel?: string;
  passwordHint?: string;
  credentials?: "phone" | "username";
  start: (ctx: ProviderContext, phone: string, save: (values: Record<string, string>) => void) => Promise<AuthStep>;
  verifyCode: (ctx: ProviderContext, transactionHash: string, code: string, save: (values: Record<string, string>) => void) => Promise<AuthStep>;
  verifyPassword: (ctx: ProviderContext, transactionHash: string, password: string, save: (values: Record<string, string>) => void) => Promise<AuthStep>;
  logout: (ctx: ProviderContext, save: (values: Record<string, string>) => void) => Promise<AuthStep>;
}

export type Category = "messenger" | "banking" | "payment" | "sms" | "map" | "utility";

export type Region = "iran" | "international";

export interface ProviderDef {
  id: string;
  name: string;
  nameFa: string;
  category: Category;
  region?: Region;
  unofficial?: boolean;
  color: string;
  glyph: string;
  description: string;
  docsUrl?: string;
  fields: ProviderField[];
  tools: ToolDef<any>[];
  test?: (ctx: ProviderContext) => Promise<unknown>;
  auth?: ProviderAuthDef;
  receive?: ReceiveDef;
  actions?: Record<string, { title: string; run: (ctx: ProviderContext) => Promise<unknown> }>;
}

export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = "ProviderError";
  }
}
