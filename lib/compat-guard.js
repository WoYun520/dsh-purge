/**
 * 运行时版本守卫 —— 面向 DSH 0.2.2-rc.1 适配的最小侵入层。
 *
 * 背景：安装时 DSH 只读 `engines.dsh`（没有再读 peerDependencies），
 * 所以插件版本能否装上由 package.json 决定；这里只管「装上也别让宿主宕机」。
 *
 * 判定失败时不抛错、不改宿主文件，只把 `enabled` 当作 false 让 apply 提前返回，
 * 这样 Cordis 其余行照常起树，网页还能打开，用户可以在插件面板里看日志。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** 本插件用到、且必须在宿主里注册的服务。缺任何一个就说明版本面变了。 */
export const REQUIRED_SERVICES = ["systemPrompt", "tools"];

/** 本插件监听的核心事件。 */
export const REQUIRED_EVENTS = [
  "system-prompt/assemble",
  "agent/pre-step",
  "session/created",
  "tools/pre-execute",
  "tools/post-execute",
];

const log = (...args) => console.warn("[dsh-purge][compat]", ...args);

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "package.json"), "utf8"));
}

/**
 * 不依赖 app-boot 解析的自查：读插件自己的 engines.dsh，再按运行中宿主的
 * 主包版本判断。宿主主包版本用 `@deepseek-ai/dsh/package.json` 定位，找不到时
 * 退化为「运行时提供的 dsh 版本」探测；两者都拿不到就返回 null（交给服务面兜底）。
 */
function readRuntimeVersionFromHost() {
  const roots = [];
  for (const entry of Object.values(requireResolvePaths())) roots.push(entry);
  roots.push(process.cwd());
  // 运行时入口（dsh/lib/bin.js）所在的安装根：往上找带 node_modules/@deepseek-ai 的目录。
  try {
    let dir = fs.realpathSync(process.argv[1] ? path.dirname(process.argv[1]) : ".");
    for (let i = 0; i < 6; i += 1) {
      if (fs.existsSync(path.join(dir, "node_modules", "@deepseek-ai"))) {
        roots.push(dir);
        break;
      }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch { /* ignore */ }
  // 已知安装布局兜底：dsh 启动器在 PATH 上时，它的 realpath 指向 <root>/node_modules/@deepseek-ai/dsh/lib/bin.js。
  for (const shim of (process.env.PATH || "").split(path.delimiter)) {
    if (!shim) continue;
    try {
      const real = fs.realpathSync(path.join(shim, "dsh"));
      const idx = real.indexOf(`${path.sep}node_modules${path.sep}`);
      if (idx > 0) roots.push(real.slice(0, idx));
    } catch { /* 没有这个 shim */ }
  }
  roots.push("/opt/dsh");
  for (const root of roots) {
    try {
      const pkgPath = require.resolve("@deepseek-ai/dsh/package.json", { paths: [root] });
      const version = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
      if (typeof version === "string" && version) return version;
    } catch { /* 继续找 */ }
    // 插件装在本机时，宿主主包可能只出现在 profile 的 node_modules 里。
    try {
      const direct = path.join(root, "node_modules", "@deepseek-ai", "dsh", "package.json");
      const version = JSON.parse(fs.readFileSync(direct, "utf8")).version;
      if (typeof version === "string" && version) return version;
    } catch { /* 继续找 */ }
  }
  return null;
}

function requireResolvePaths() {
  const roots = { plugin: PLUGIN_ROOT };
  try {
    roots.moduleDir = path.dirname(fileURLToPath(import.meta.url));
  } catch { /* ignore */ }
  const profileDir = process.env.DSH_PROFILE_DIR;
  if (profileDir) roots.profile = profileDir;
  return roots;
}

/** 极简 semver 区间判定，只覆盖本插件声明用到的写法：>=A <B、^A、~A、A。 */
function satisfiesRange(version, range) {
  const parse = (v) => {
    const m = String(v).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || "" } : null;
  };
  const cmp = (a, b) => {
    for (let i = 0; i < 3; i += 1) if (a.nums[i] !== b.nums[i]) return a.nums[i] - b.nums[i];
    // 预发布版小于同号的正式版
    if (a.pre && !b.pre) return -1;
    if (!a.pre && b.pre) return 1;
    return a.pre === b.pre ? 0 : (a.pre < b.pre ? -1 : 1);
  };
  const v = parse(version);
  if (!v) return false;
  const allowPre = /-/.test(String(range).trim()) || Boolean(v.pre);
  return String(range).split(/\s+/).filter(Boolean).every((clause) => {
    const m = clause.match(/^(>=|<=|>|<|=|\^|~)?(.+)$/);
    if (!m) return false;
    const op = m[1] || "=";
    const bound = parse(m[2]);
    if (!bound) return false;
    if (bound.pre && !allowPre) return false;
    const c = cmp(v, bound);
    switch (op) {
      case ">=": return c >= 0;
      case "<=": return c <= 0;
      case ">": return c > 0;
      case "<": return c < 0;
      case "^": {
        const upper = { nums: [bound.nums[0], bound.nums[0] === 0 ? bound.nums[1] + 1 : bound.nums[0], bound.nums[0] === 0 && bound.nums[1] === 0 ? bound.nums[2] + 1 : 0], pre: "" };
        if (bound.nums[0] > 0) { upper.nums = [bound.nums[0] + 1, 0, 0]; }
        return c >= 0 && cmp(v, upper) < 0;
      }
      case "~": {
        const upper = { nums: [bound.nums[0], bound.nums[1] + 1, 0], pre: "" };
        return c >= 0 && cmp(v, upper) < 0;
      }
      default: return c === 0;
    }
  });
}

/**
 * 自查插件声明的 engines.dsh。app-boot 不在解析路径时用这份回退，结论与官方一致。
 * @returns {{ok: boolean, runtime: string|null, requirements?: object, source: string}|null}
 */
export function checkDeclaredRangeFromHost() {
  const manifest = readManifest();
  const range = manifest?.engines?.dsh;
  if (typeof range !== "string" || !range.trim()) return null;
  const runtime = readRuntimeVersionFromHost();
  if (!runtime) return null;
  if (satisfiesRange(runtime, range)) return { ok: true, runtime, source: "fallback" };
  return { ok: false, runtime, requirements: { "engines.dsh": range }, source: "fallback" };
}

/**
 * 用官方 app-boot 的判定函数自查一遍。
 * app-boot 不在解析路径里时返回 null（视为「无法判定」），交给服务/事件探测兜底。
 */
export async function checkManifestCompatibility() {
  try {
    const boot = await import("@deepseek-ai/dsh-app-boot");
    if (typeof boot.evaluatePluginCompatibility !== "function") return null;
    const issue = boot.evaluatePluginCompatibility(readManifest(), {});
    if (issue === undefined) return { ok: true, runtime: boot.getDshRuntimeVersion?.() };
    return {
      ok: false,
      runtime: issue.runtimeVersion,
      requirements: issue.requirements,
      message: typeof boot.pluginCompatibilityWarning === "function"
        ? boot.pluginCompatibilityWarning(issue)
        : `dsh-purge is incompatible with dsh ${issue.runtimeVersion}`,
    };
  } catch (error) {
    log("manifest check skipped:", String(error?.message || error));
    // app-boot 不在解析路径（便携安装常见）：用同一份 engines.dsh + 宿主版本自查。
    return checkDeclaredRangeFromHost();
  }
}

/** 探测服务与事件是否齐全；Cordis 没有统一的事件目录，事件按 `ctx.on` 是否可用 + 已知名粗检。 */
export function checkHostSurface(ctx) {
  const missingServices = [];
  for (const name of REQUIRED_SERVICES) {
    let present = false;
    try {
      present = ctx?.get?.(name) !== undefined;
    } catch {
      present = false;
    }
    if (!present) missingServices.push(name);
  }
  const hasOn = typeof ctx?.on === "function";
  const hasEffect = typeof ctx?.effect === "function";
  return {
    ok: missingServices.length === 0 && hasOn && hasEffect,
    missingServices,
    missing: [
      ...missingServices.map((n) => `service:${n}`),
      ...(hasOn ? [] : ["ctx.on"]),
      ...(hasEffect ? [] : ["ctx.effect"]),
    ],
  };
}

/**
 * 汇总判定。任何一项不通过都返回 ok:false，调用方据此静默禁用。
 * @returns {Promise<{ok: boolean, reason?: string, detail?: object}>}
 */
export async function guardRuntime(ctx) {
  const manifest = await checkManifestCompatibility();
  if (manifest && !manifest.ok) {
    log(manifest.message);
    return { ok: false, reason: "manifest-version", detail: manifest };
  }
  const surface = checkHostSurface(ctx);
  if (!surface.ok) {
    const reason = `host surface missing: ${surface.missing.join(", ")}`;
    log(reason);
    return { ok: false, reason: "host-surface", detail: surface };
  }
  return { ok: true };
}
