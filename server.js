const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const express = require("express");
const expressSession = require("express-session");
const multer = require("multer");

const PORT = Number.parseInt(process.env.PORT || "3200", 10);
const ROOT_DIR = __dirname;
const STORAGE_DIR = process.env.AURA_HUB_STORAGE_DIR
  ? path.resolve(process.env.AURA_HUB_STORAGE_DIR)
  : ROOT_DIR;
const DATA_DIR = path.join(STORAGE_DIR, "data");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const UPLOAD_DIR = path.join(STORAGE_DIR, "uploads");
const ICON_DIR = path.join(UPLOAD_DIR, "icons");
const SHORTCUTS_FILE = path.join(DATA_DIR, "shortcuts.json");
const MAX_ICON_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8000;
const AUTHENTIK_ENABLED = !["0", "false", "off"].includes(String(process.env.AURA_HUB_AUTHENTIK_ENABLED || "true").trim().toLowerCase());
const AUTHENTIK_BASE_URL = String(process.env.AURA_HUB_AUTHENTIK_BASE_URL || "").trim().replace(/\/+$/, "");
const AUTHENTIK_PROVIDER_SLUG = String(process.env.AURA_HUB_AUTHENTIK_PROVIDER_SLUG || "glow").trim() || "glow";
const AUTHENTIK_CLIENT_ID = String(process.env.AURA_HUB_AUTHENTIK_CLIENT_ID || "").trim();
const AUTHENTIK_CLIENT_SECRET = String(process.env.AURA_HUB_AUTHENTIK_CLIENT_SECRET || "").trim();
const SESSION_SECRET = String(process.env.AURA_HUB_SESSION_SECRET || "").trim() || crypto.randomBytes(32).toString("hex");
const PUBLIC_BASE_URL = String(process.env.AURA_HUB_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const AUTH_STATE_SESSION_KEY = "authentik_state";
const AUTH_USER_SESSION_KEY = "authentik_user";
const AUTH_CALLBACK_PATH = "/auth/callback";
const AUTH_LOGIN_PATH = "/auth/login";
const AUTH_LOGOUT_PATH = "/auth/logout";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ICON_BYTES },
});

app.set("trust proxy", 1);
app.use(expressSession({
  name: "aura_hub_session",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 12 * 60 * 60 * 1000,
  },
}));

app.use(express.json({ limit: "1mb" }));
app.use((request, response, next) => {
  if (request.path === "/" || request.path === "/index.html") {
    response.setHeader("Cache-Control", "no-store");
  }
  next();
});

app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d" }));
app.use(express.static(PUBLIC_DIR, { index: false, extensions: ["html"] }));

function isAuthentikConfigured() {
  return AUTHENTIK_ENABLED
    && Boolean(AUTHENTIK_BASE_URL)
    && Boolean(AUTHENTIK_CLIENT_ID)
    && Boolean(AUTHENTIK_CLIENT_SECRET);
}

function buildPublicBaseUrl(request) {
  if (PUBLIC_BASE_URL) {
    return PUBLIC_BASE_URL;
  }

  const host = request.get("host");
  return `${request.protocol}://${host}`;
}

function buildAuthentikCallbackUrl(request) {
  return `${buildPublicBaseUrl(request)}${AUTH_CALLBACK_PATH}`;
}

function buildAuthentikAuthorizeUrl(request) {
  const url = new URL(`${AUTHENTIK_BASE_URL}/application/o/authorize/`);
  url.searchParams.set("client_id", AUTHENTIK_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("redirect_uri", buildAuthentikCallbackUrl(request));
  url.searchParams.set("state", request.session[AUTH_STATE_SESSION_KEY]);
  return url.toString();
}

function currentUser(request) {
  return request.session[AUTH_USER_SESSION_KEY] || null;
}

function requireAuth(request, response, next) {
  if (!isAuthentikConfigured()) {
    next();
    return;
  }

  if (currentUser(request)) {
    next();
    return;
  }

  if (request.path.startsWith("/api/")) {
    response.status(401).json({ error: "Sign in required.", loginUrl: "/login" });
    return;
  }

  response.redirect("/login");
}

function renderLoginPage(errorMessage = "") {
  const safeError = String(errorMessage || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AURA IT HUB | Sign In</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap" rel="stylesheet">
    <link rel="icon" href="/logo-icon-new.png">
    <link rel="stylesheet" href="/styles.css?v=20260315-1">
    <style>
      .login-shell{width:min(680px,calc(100% - 32px));margin:0 auto;padding:48px 0 80px}
      .login-card{padding:34px;border-radius:32px;display:grid;gap:18px}
      .login-card h1{margin:0;font-size:clamp(1.7rem,4vw,2.4rem)}
      .login-card p{margin:0;color:var(--muted);line-height:1.5}
      .login-row{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
      .login-brand{display:flex;align-items:center;gap:14px}
      .login-brand img{width:56px;height:56px;object-fit:contain}
      .login-auth-button{display:inline-flex;align-items:center;justify-content:center;gap:12px;min-height:56px;padding:14px 18px;border-radius:20px;border:1px solid rgba(255,132,90,.3);background:radial-gradient(circle at top, rgba(255,255,255,.14), transparent 62%),linear-gradient(135deg, #401116 0%, #8f241f 45%, #fd4b2d 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 16px 34px rgba(125,29,17,.34);color:#f8f7ff;text-decoration:none;font-weight:700}
      .login-auth-button:hover{transform:translateY(-1px)}
      .login-auth-mark{width:30px;height:30px;display:block}
      .login-error{padding:12px 14px;border-radius:16px;border:1px solid rgba(248,113,113,.35);background:rgba(127,29,29,.22);color:#ffd7d7}
      .login-meta{display:grid;gap:8px;padding:18px;border-radius:20px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04)}
      @@media (max-width:720px){.login-shell{padding:28px 0 56px}.login-card{padding:24px}}
    </style>
  </head>
  <body>
    <div class="wallpaper-base" aria-hidden="true"></div>
    <div class="wallpaper-grid" aria-hidden="true"></div>
    <div class="wallpaper-vignette" aria-hidden="true"></div>
    <div class="orb orb-cyan" aria-hidden="true"></div>
    <div class="orb orb-violet" aria-hidden="true"></div>
    <div class="orb orb-blue" aria-hidden="true"></div>
    <main class="login-shell">
      <section class="login-card glass-panel">
        <div class="login-row">
          <div class="login-brand">
            <img src="/logo-icon-new.png" alt="AURA IT logo">
            <div>
              <p class="eyebrow">AURA IT</p>
              <h1>AURA IT HUB</h1>
            </div>
          </div>
        </div>
        <div class="login-meta">
          <p class="eyebrow">Single Sign-On</p>
          <p>Sign in with Authentik to access the same workspace identity used across Glow.</p>
        </div>
        ${safeError ? `<div class="login-error">${safeError}</div>` : ""}
        <a class="login-auth-button" href="${AUTH_LOGIN_PATH}">
          <img class="login-auth-mark" src="https://auth.aurait.com.au/static/dist/assets/icons/icon.png" alt="">
          <span>Continue with Authentik</span>
        </a>
      </section>
    </main>
  </body>
</html>`;
}

async function exchangeAuthentikCode(request, code) {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", AUTHENTIK_CLIENT_ID);
  body.set("client_secret", AUTHENTIK_CLIENT_SECRET);
  body.set("code", String(code || "").trim());
  body.set("redirect_uri", buildAuthentikCallbackUrl(request));

  const response = await fetchWithTimeout(`${AUTHENTIK_BASE_URL}/application/o/token/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error("The Authentik token exchange failed.");
  }

  return response.json();
}

async function loadAuthentikProfile(accessToken) {
  const response = await fetchWithTimeout(`${AUTHENTIK_BASE_URL}/application/o/userinfo/`, {
    headers: {
      authorization: `Bearer ${String(accessToken || "").trim()}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Could not read the Authentik user profile.");
  }

  return response.json();
}

function sanitizeName(value) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    throw new Error("Shortcut name is required.");
  }
  return cleaned.slice(0, 80);
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("A URL is required.");
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }

  return url.toString();
}

function slugify(value) {
  return String(value || "icon")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "icon";
}

function htmlAttribute(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return match ? match[1] || match[2] || match[3] || "" : "";
}

function extensionFromContentType(contentType) {
  const normalized = String(contentType || "").toLowerCase().split(";")[0].trim();
  switch (normalized) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/svg+xml":
      return ".svg";
    case "image/webp":
      return ".webp";
    case "image/x-icon":
    case "image/vnd.microsoft.icon":
      return ".ico";
    default:
      return "";
  }
}

function extensionFromUrl(value) {
  const pathname = new URL(value).pathname.toLowerCase();
  const ext = path.extname(pathname);
  return [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"].includes(ext) ? ext : "";
}

function isAllowedImageContentType(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  return normalized.startsWith("image/") || normalized === "";
}

async function ensureRuntimeFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(ICON_DIR, { recursive: true });

  if (!fsSync.existsSync(SHORTCUTS_FILE)) {
    await fs.writeFile(SHORTCUTS_FILE, "[]\n", "utf8");
  }
}

async function readShortcuts() {
  await ensureRuntimeFiles();
  const raw = await fs.readFile(SHORTCUTS_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((shortcut, index) => ({ ...shortcut, order: index }));
}

async function writeShortcuts(shortcuts) {
  const ordered = shortcuts.map((shortcut, index) => ({ ...shortcut, order: index }));
  const tempFile = `${SHORTCUTS_FILE}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
  await fs.rename(tempFile, SHORTCUTS_FILE);
  return ordered;
}

async function fetchWithTimeout(resource, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(resource, {
      ...options,
      signal: controller.signal,
      headers: {
        "user-agent": "AURA IT HUB/1.0",
        accept: "*/*",
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function removeIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }
}

function isManagedIcon(iconPath) {
  return String(iconPath || "").startsWith("/uploads/icons/");
}

async function removeManagedIcon(iconPath) {
  if (!isManagedIcon(iconPath)) {
    return;
  }

  const iconFilePath = path.join(STORAGE_DIR, iconPath.replace(/^\//, "").replace(/\//g, path.sep));
  await removeIfExists(iconFilePath);
}

async function saveBufferAsIcon(buffer, shortcutId, baseName, extension) {
  const revision = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const fileName = `${shortcutId}-${revision}-${slugify(baseName)}${extension || ".png"}`;
  const filePath = path.join(ICON_DIR, fileName);
  await fs.writeFile(filePath, buffer);
  return {
    filePath,
    publicPath: `/uploads/icons/${fileName}`,
  };
}

async function downloadIcon(iconUrl, shortcutId, baseName) {
  const response = await fetchWithTimeout(iconUrl, {
    headers: {
      accept: "image/*,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Icon download failed with status ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType && !isAllowedImageContentType(contentType)) {
    throw new Error("The icon URL did not return an image.");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) {
    throw new Error("The icon file was empty.");
  }
  if (bytes.length > MAX_ICON_BYTES) {
    throw new Error("The icon file exceeded the upload limit.");
  }

  const extension = extensionFromContentType(contentType) || extensionFromUrl(iconUrl) || ".png";
  const { publicPath } = await saveBufferAsIcon(bytes, shortcutId, baseName, extension);
  return publicPath;
}

function pickBestIconHref(html, pageUrl) {
  const matches = html.match(/<link\b[^>]*>/gi) || [];
  const candidates = [];

  for (const tag of matches) {
    const rel = htmlAttribute(tag, "rel").toLowerCase();
    const href = htmlAttribute(tag, "href");

    if (!href || !rel.includes("icon")) {
      continue;
    }

    let score = 0;
    if (rel.includes("shortcut")) score += 3;
    if (rel.includes("apple-touch")) score += 1;
    if (rel.trim() === "icon") score += 2;

    try {
      candidates.push({
        score,
        href: new URL(href, pageUrl).toString(),
      });
    } catch (error) {
      // Ignore malformed icon references in upstream sites.
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.href || null;
}

function googleFallbackIcon(targetUrl) {
  const hostname = new URL(targetUrl).hostname;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
}

async function resolveSiteIcon(targetUrl, shortcutId, shortcutName) {
  try {
    const pageResponse = await fetchWithTimeout(targetUrl, {
      headers: { accept: "text/html,application/xhtml+xml" },
    });

    let iconUrl = null;
    if (pageResponse.ok) {
      const html = await pageResponse.text();
      iconUrl = pickBestIconHref(html, targetUrl);
    }

    if (!iconUrl) {
      iconUrl = new URL("/favicon.ico", targetUrl).toString();
    }

    return {
      iconPath: await downloadIcon(iconUrl, shortcutId, shortcutName),
      iconSource: "website",
    };
  } catch (error) {
    return {
      iconPath: googleFallbackIcon(targetUrl),
      iconSource: "website-fallback",
    };
  }
}

async function persistUploadedIcon(file, shortcutId, shortcutName) {
  const extension = path.extname(file.originalname || "").toLowerCase()
    || extensionFromContentType(file.mimetype)
    || ".png";

  if (![".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"].includes(extension)) {
    throw new Error("Unsupported icon file type.");
  }

  const { publicPath } = await saveBufferAsIcon(file.buffer, shortcutId, shortcutName, extension);
  return publicPath;
}

function summarizeShortcut(shortcut) {
  return {
    id: shortcut.id,
    name: shortcut.name,
    url: shortcut.url,
    hostname: shortcut.hostname,
    iconPath: shortcut.iconPath,
    iconSource: shortcut.iconSource,
    order: shortcut.order,
    createdAt: shortcut.createdAt,
    updatedAt: shortcut.updatedAt || null,
  };
}

async function buildShortcutIcon({ file, iconUrl, targetUrl, shortcutId, shortcutName }) {
  if (file) {
    return {
      iconPath: await persistUploadedIcon(file, shortcutId, shortcutName),
      iconSource: "upload",
    };
  }

  if (iconUrl) {
    try {
      return {
        iconPath: await downloadIcon(normalizeUrl(iconUrl), shortcutId, shortcutName),
        iconSource: "external",
      };
    } catch (error) {
      throw new Error("The external icon URL could not be downloaded.");
    }
  }

  return resolveSiteIcon(targetUrl, shortcutId, shortcutName);
}

app.get("/api/health", async (request, response) => {
  response.json({ ok: true });
});

app.get("/login", (request, response) => {
  if (!isAuthentikConfigured()) {
    response.redirect("/");
    return;
  }

  if (currentUser(request)) {
    response.redirect("/");
    return;
  }

  response
    .status(200)
    .type("html")
    .send(renderLoginPage(request.query.error || ""));
});

app.get(AUTH_LOGIN_PATH, (request, response) => {
  if (!isAuthentikConfigured()) {
    response.redirect("/");
    return;
  }

  const state = crypto.randomBytes(24).toString("hex");
  request.session[AUTH_STATE_SESSION_KEY] = state;
  response.redirect(buildAuthentikAuthorizeUrl(request));
});

app.get(AUTH_CALLBACK_PATH, async (request, response) => {
  if (!isAuthentikConfigured()) {
    response.redirect("/");
    return;
  }

  try {
    const expectedState = String(request.session[AUTH_STATE_SESSION_KEY] || "").trim();
    delete request.session[AUTH_STATE_SESSION_KEY];

    if (!expectedState || expectedState !== String(request.query.state || "").trim()) {
      throw new Error("Authentik sign-in state did not match. Please try again.");
    }

    const tokens = await exchangeAuthentikCode(request, request.query.code || "");
    const profile = await loadAuthentikProfile(tokens.access_token);
    const username = String(profile.preferred_username || profile.nickname || profile.email || "").trim();
    if (!username) {
      throw new Error("Authentik did not return a usable username.");
    }

    request.session[AUTH_USER_SESSION_KEY] = {
      username,
      name: String(profile.name || username).trim(),
      email: String(profile.email || "").trim(),
    };
    response.redirect("/");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentik sign-in failed.";
    response.redirect(`/login?error=${encodeURIComponent(message)}`);
  }
});

app.get(AUTH_LOGOUT_PATH, (request, response, next) => {
  request.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }

    response.clearCookie("aura_hub_session");
    response.redirect("/login");
  });
});

app.get("/api/session", requireAuth, (request, response) => {
  response.json({
    ok: true,
    user: currentUser(request),
    authentikEnabled: isAuthentikConfigured(),
  });
});

app.use("/api/shortcuts", requireAuth);
app.get("/api/shortcuts", async (request, response, next) => {
  try {
    const shortcuts = await readShortcuts();
    response.json(shortcuts.map(summarizeShortcut));
  } catch (error) {
    next(error);
  }
});

app.post("/api/shortcuts", upload.single("iconFile"), async (request, response, next) => {
  const shortcutId = crypto.randomUUID();
  let createdManagedIconPath = "";

  try {
    const name = sanitizeName(request.body.name);
    const targetUrl = normalizeUrl(request.body.url);
    const externalIconUrl = String(request.body.iconUrl || "").trim();
    const hostname = new URL(targetUrl).hostname.replace(/^www\./, "");
    const { iconPath, iconSource } = await buildShortcutIcon({
      file: request.file,
      iconUrl: externalIconUrl,
      targetUrl,
      shortcutId,
      shortcutName: name,
    });
    createdManagedIconPath = isManagedIcon(iconPath) ? iconPath : "";

    const shortcuts = await readShortcuts();
    const shortcut = {
      id: shortcutId,
      name,
      url: targetUrl,
      hostname,
      iconPath,
      iconSource,
      order: shortcuts.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    shortcuts.push(shortcut);
    const savedShortcuts = await writeShortcuts(shortcuts);
    const savedShortcut = savedShortcuts.find((entry) => entry.id === shortcutId);

    response.status(201).json(summarizeShortcut(savedShortcut));
  } catch (error) {
    await removeManagedIcon(createdManagedIconPath);
    next(error);
  }
});

app.put("/api/shortcuts/:shortcutId", upload.single("iconFile"), async (request, response, next) => {
  let createdManagedIconPath = "";
  try {
    const shortcutId = request.params.shortcutId;
    const shortcuts = await readShortcuts();
    const existingShortcut = shortcuts.find((entry) => entry.id === shortcutId);

    if (!existingShortcut) {
      response.status(404).json({ error: "Shortcut not found." });
      return;
    }

    const name = sanitizeName(request.body.name);
    const targetUrl = normalizeUrl(request.body.url);
    const externalIconUrl = String(request.body.iconUrl || "").trim();
    const hostname = new URL(targetUrl).hostname.replace(/^www\./, "");
    const websiteSourceChanged = existingShortcut.url !== targetUrl
      && ["website", "website-fallback"].includes(existingShortcut.iconSource);

    let nextIconPath = existingShortcut.iconPath;
    let nextIconSource = existingShortcut.iconSource;
    if (request.file || externalIconUrl || websiteSourceChanged) {
      const replacement = await buildShortcutIcon({
        file: request.file,
        iconUrl: externalIconUrl,
        targetUrl,
        shortcutId,
        shortcutName: name,
      });
      nextIconPath = replacement.iconPath;
      nextIconSource = replacement.iconSource;
      createdManagedIconPath = isManagedIcon(replacement.iconPath) ? replacement.iconPath : "";
    }

    const updatedShortcut = {
      ...existingShortcut,
      name,
      url: targetUrl,
      hostname,
      iconPath: nextIconPath,
      iconSource: nextIconSource,
      updatedAt: new Date().toISOString(),
    };

    const savedShortcuts = await writeShortcuts(shortcuts.map((entry) => (
      entry.id === shortcutId ? updatedShortcut : entry
    )));

    if (existingShortcut.iconPath !== nextIconPath) {
      await removeManagedIcon(existingShortcut.iconPath);
    }

    const savedShortcut = savedShortcuts.find((entry) => entry.id === shortcutId);
    response.json(summarizeShortcut(savedShortcut));
  } catch (error) {
    await removeManagedIcon(createdManagedIconPath);
    next(error);
  }
});

app.put("/api/shortcuts/order", async (request, response, next) => {
  try {
    const orderedIds = Array.isArray(request.body.orderedIds) ? request.body.orderedIds : [];
    const shortcuts = await readShortcuts();

    if (orderedIds.length !== shortcuts.length) {
      throw new Error("Shortcut order update did not include every shortcut.");
    }
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new Error("Shortcut order update contained duplicate shortcuts.");
    }

    const shortcutMap = new Map(shortcuts.map((shortcut) => [shortcut.id, shortcut]));
    const reordered = orderedIds.map((id) => {
      if (!shortcutMap.has(id)) {
        throw new Error("Shortcut order update contained an unknown shortcut.");
      }
      return shortcutMap.get(id);
    });

    const savedShortcuts = await writeShortcuts(reordered);
    response.json(savedShortcuts.map(summarizeShortcut));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/shortcuts/:shortcutId", async (request, response, next) => {
  try {
    const shortcuts = await readShortcuts();
    const shortcut = shortcuts.find((entry) => entry.id === request.params.shortcutId);

    if (!shortcut) {
      response.status(404).json({ error: "Shortcut not found." });
      return;
    }

    const remaining = shortcuts.filter((entry) => entry.id !== request.params.shortcutId);
    const savedShortcuts = await writeShortcuts(remaining);

    await removeManagedIcon(shortcut.iconPath);

    response.json({
      ok: true,
      shortcuts: savedShortcuts.map(summarizeShortcut),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/", requireAuth, (request, response) => {
  response.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/index.html", requireAuth, (request, response) => {
  response.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("*", requireAuth, (request, response) => {
  response.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((error, request, response, next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(400).json({ error: "Icons must be 4 MB or smaller." });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected server error.";
  const statusCode = /required|supported|could not|did not|unknown|limit|type|downloaded/i.test(message) ? 400 : 500;

  response.status(statusCode).json({ error: message });
});

ensureRuntimeFiles()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`AURA IT HUB running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start AURA IT HUB", error);
    process.exit(1);
  });
