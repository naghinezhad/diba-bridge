/**
 * اعتبارسنجی مشخصات سازمان/پروژه که در نصب اولیه و صفحه‌ی «نصب و مشخصات» گرفته می‌شود.
 * هر چیزی که اینجا رد شود هرگز در config.json ذخیره نمی‌شود.
 */

export interface ProfileInput {
  ownerName: string;
  orgName: string;
  description: string;
  website: string;
  /** رشته‌ی خالی یعنی «بدون لوگو» */
  logo: string;
}

export const PROFILE_LIMITS = {
  ownerName: 80,
  orgName: 80,
  description: 300,
  website: 200,
  /** حجم فایل لوگو پس از decode */
  logoBytes: 300 * 1024,
} as const;

/** فقط تصویر بیت‌مپ؛ SVG می‌تواند اسکریپت و ارجاع بیرونی داشته باشد و پذیرفته نمی‌شود */
const LOGO_TYPES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP",
  "image/gif": (b) => b.length > 6 && /^GIF8[79]a$/.test(b.toString("latin1", 0, 6)),
};

export class ProfileError extends Error {
  constructor(message: string, public readonly field: keyof ProfileInput) {
    super(message);
    this.name = "ProfileError";
  }
}

/** کاراکترهای کنترلی و فاصله‌های تکراری حذف می‌شوند تا متن در هر جایی امن و یک‌خطی نمایش داده شود */
function cleanText(value: unknown, multiline = false): string {
  const text = typeof value === "string" ? value : "";
  const stripped = multiline
    ? text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    : text.replace(/[\u0000-\u001f\u007f]/g, " ");
  return stripped.replace(/[ \t]+/g, " ").trim();
}

function text(value: unknown, field: "ownerName" | "orgName" | "description", label: string): string {
  const out = cleanText(value, field === "description");
  if (out.length > PROFILE_LIMITS[field]) {
    throw new ProfileError(`${label} نباید بیشتر از ${PROFILE_LIMITS[field]} کاراکتر باشد`, field);
  }
  return out;
}

export function normalizeWebsite(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return "";
  if (raw.length > PROFILE_LIMITS.website) throw new ProfileError("آدرس سایت خیلی طولانی است", "website");
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ProfileError("آدرس سایت معتبر نیست", "website");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ProfileError("آدرس سایت باید با http یا https شروع شود", "website");
  if (!url.hostname.includes(".") && url.hostname !== "localhost") throw new ProfileError("آدرس سایت معتبر نیست", "website");
  if (url.username || url.password) throw new ProfileError("آدرس سایت نباید نام کاربری یا رمز داشته باشد", "website");
  return url.toString().replace(/\/$/, "");
}

export function normalizeLogo(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new ProfileError("لوگو معتبر نیست", "logo");
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.trim());
  if (!match) throw new ProfileError("لوگو باید یک فایل تصویری باشد", "logo");
  const [, type, payload] = match;
  const check = LOGO_TYPES[type];
  if (!check) throw new ProfileError("قالب لوگو باید PNG، JPG، WebP یا GIF باشد", "logo");
  const bytes = Buffer.from(payload, "base64");
  if (bytes.length > PROFILE_LIMITS.logoBytes) {
    throw new ProfileError(`حجم لوگو نباید بیشتر از ${Math.round(PROFILE_LIMITS.logoBytes / 1024)} کیلوبایت باشد`, "logo");
  }
  // نوع اعلام‌شده باید با محتوای واقعی فایل یکی باشد
  if (!check(bytes)) throw new ProfileError("محتوای فایل با قالب تصویر هم‌خوانی ندارد", "logo");
  return `data:${type};base64,${bytes.toString("base64")}`;
}

/**
 * ورودی خام را به مشخصات قابل ذخیره تبدیل می‌کند.
 * `logo` فقط وقتی بررسی می‌شود که در بدنه آمده باشد؛ نبودنش یعنی «لوگوی فعلی بماند».
 */
export function normalizeProfile(body: unknown): Omit<ProfileInput, "logo"> & { logo?: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const orgName = text(b.orgName, "orgName", "نام شرکت یا پروژه");
  if (orgName.length < 2) throw new ProfileError("نام شرکت یا پروژه را وارد کنید", "orgName");
  const out: Omit<ProfileInput, "logo"> & { logo?: string } = {
    ownerName: text(b.ownerName, "ownerName", "نام"),
    orgName,
    description: text(b.description, "description", "توضیح"),
    website: normalizeWebsite(b.website),
  };
  if ("logo" in b) out.logo = normalizeLogo(b.logo);
  return out;
}
