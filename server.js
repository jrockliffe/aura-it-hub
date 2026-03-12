const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const express = require("express");
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

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ICON_BYTES },
});

app.use(express.json({ limit: "1mb" }));
app.use((request, response, next) => {
  if (request.path === "/" || request.path === "/index.html") {
    response.setHeader("Cache-Control", "no-store");
  }
  next();
});

app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d" }));
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

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

app.get("*", (request, response) => {
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
