import { resolve } from "node:path";
import { DibaMcpEngine, SERVER_VERSION } from "./core/engine.js";
import { configureMedia } from "./core/media.js";
import { configureProxy } from "./core/net.js";
import { proxyEnvOf, readStoredSettings } from "./core/store.js";
import type { ProviderDef } from "./core/types.js";
import { createDibaMcpRouter, type RouterOptions } from "./http/router.js";
import { builtinProviders } from "./providers/index.js";

export interface CreateOptions {
  dataDir?: string;
  extraProviders?: ProviderDef[];
  only?: string[];
  env?: NodeJS.ProcessEnv;
}

export function createDibaMcp(opts: CreateOptions = {}) {
  const dataDir = resolve(opts.dataDir ?? process.env.DATA_DIR ?? "./data");
  const baseEnv = opts.env ?? process.env;
  const proxyEnv = proxyEnvOf(readStoredSettings(dataDir));
  const env = { ...baseEnv, ...proxyEnv };
  if (Object.keys(proxyEnv).length) Object.assign(process.env, proxyEnv);
  configureProxy(env);
  configureMedia(env);
  let providers = [...builtinProviders, ...(opts.extraProviders ?? [])];
  if (opts.only) providers = providers.filter((p) => opts.only!.includes(p.id));
  const engine = new DibaMcpEngine({ dataDir, providers, env });
  return {
    engine,
    dataDir,
    version: SERVER_VERSION,
    router: (o?: RouterOptions) => createDibaMcpRouter(engine, o),
    createMcpServer: () => engine.createMcpServer(),
  };
}

export { DibaMcpEngine, SERVER_VERSION } from "./core/engine.js";
export { startHttp, startStdio, printNetcheck } from "./server.js";
export { defineTool, ProviderError } from "./core/types.js";
export type { ProviderDef, ToolDef, ProviderField, ProviderContext, ProviderAuthDef, AuthStep, AuthUser, Category, Region } from "./core/types.js";
export { builtinProviders, baleClient, binance, blubank, bybit, eitaaClient, instagram, kraken, kucoin, linkedinProvider, okx, rubikaClient, soroushClient, telegramClient, whatsapp, wordpress, x } from "./providers/index.js";
export { defineExchange } from "./providers/exchanges/common.js";
export type { ExchangeAdapter } from "./providers/exchanges/common.js";
export { createDibaMcpRouter } from "./http/router.js";
export { configureProxy, proxyMode } from "./core/net.js";
export { runNetcheck } from "./core/netcheck.js";
