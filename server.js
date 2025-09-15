import express from "express";
import multer from "multer";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "output");

for (const dir of [UPLOAD_DIR, OUTPUT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use(express.static(path.join(__dirname, "public")));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^\w.\-]/g, "_");
    cb(null, `${ts}-${safe}`);
  }
});
const upload = multer({ storage });

const execFileAsync = promisify(execFile);

// ---------- Helpers ----------
function toWebpName(inputPath) {
  const base = path.basename(inputPath);
  const noExt = base.replace(/\.[^.]+$/, "");
  return `${noExt}.webp`;
}
function changeExt(baseName, ext) {
  const noExt = baseName.replace(/\.[^.]+$/, "");
  return `${noExt}.${ext}`;
}

async function convertWebP(inputPath, outputPath, { quality, lossless, resize }) {
  const args = [inputPath];

  if (resize && String(resize).trim()) {
    args.push("-resize", String(resize).trim());
  }

  args.push("-strip");

  if (lossless) {
    args.push("-define", "webp:lossless=true");
  } else {
    const q = Math.min(100, Math.max(0, Number(quality ?? 82)));
    args.push("-quality", String(q));
    args.push("-define", "webp:method=6");
  }

  args.push(outputPath);
  await execFileAsync("magick", args);
}

async function convertGeneric(inputPath, outputPath, opts) {
  const {
    target = "jpg",
    quality = 82,
    pngCompression = 9,
    lossless = false,
    resize = "",
    strip = true,
    background = "#ffffff"
  } = opts || {};

  const args = [inputPath];

  args.push("-auto-orient");
  if (resize && String(resize).trim()) args.push("-resize", String(resize).trim());
  if (strip) args.push("-strip");
  args.push("-colorspace", "sRGB");

  if (target === "jpg" || target === "jpeg") {
    args.push("-background", background, "-alpha", "remove", "-alpha", "off");
    const q = Math.min(100, Math.max(0, Number(quality)));
    args.push("-quality", String(q));
  }

  if (target === "png") {
    const lvl = Math.min(9, Math.max(0, Number(pngCompression)));
    args.push("-define", `png:compression-level=${lvl}`);
  }

  if (target === "heic") {
    if (lossless) {
      args.push("-define", "heic:lossless=true");
    } else {
      const q = Math.min(100, Math.max(0, Number(quality)));
      args.push("-quality", String(q));
      args.push("-define", "heic:speed=1");
    }
  }

  args.push(outputPath);
  await execFileAsync("magick", args);
}

// ---------- Endpoints UI ----------
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public/index.html")));
app.get("/webp", (_req, res) => res.sendFile(path.join(__dirname, "public/webp.html")));
app.get("/convert", (_req, res) => res.sendFile(path.join(__dirname, "public/convert.html")));

// ---------- API: WebP (compresión) ----------
app.post("/api/webp", upload.array("images", 200), async (req, res) => {
  try {
    const { quality, lossless, resize, zip } = req.body;
    if (!req.files?.length) return res.status(400).json({ error: "No se recibieron imágenes." });

    const batchId = Date.now().toString(36);
    const batchDir = path.join(OUTPUT_DIR, batchId);
    fs.mkdirSync(batchDir, { recursive: true });

    const results = [];
    for (const f of req.files) {
      const inPath = f.path;
      const outName = toWebpName(inPath);
      const outPath = path.join(batchDir, outName);

      await convertWebP(inPath, outPath, {
        quality,
        lossless: String(lossless) === "true",
        resize
      });

      const originalSize = fs.statSync(inPath).size;
      const webpSize = fs.statSync(outPath).size;

      results.push({
        original: path.basename(f.originalname),
        converted: outName,
        originalSize,
        webpSize,
        saved: Math.max(0, originalSize - webpSize)
      });

      fs.unlinkSync(inPath);
    }

    if (String(zip) === "true") {
      const zipName = `webp-${batchId}.zip`;
      const zipPath = path.join(batchDir, zipName);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      await new Promise((resolve, reject) => {
        output.on("close", resolve);
        archive.on("error", reject);
        archive.pipe(output);
        archive.directory(batchDir, false, f => (f.name.endsWith(".zip") ? false : f));
        archive.finalize();
      });

      return res.json({ batchId, zip: `/download/${batchId}/${zipName}`, results });
    }

    return res.json({
      batchId,
      files: results.map(r => ({ ...r, url: `/download/${batchId}/${r.converted}` }))
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error:
        "Error convirtiendo a WebP. Para HEIC/HEIF instala libheif y reinstala ImageMagick: 'brew install libheif' y luego 'brew reinstall imagemagick'."
    });
  }
});

// ---------- API: Conversión HEIC/JPG/PNG ----------
app.post("/api/convert", upload.array("images", 200), async (req, res) => {
  try {
    const {
      target = "jpg",
      quality,
      pngCompression,
      lossless,
      resize,
      strip,
      zip,
      background
    } = req.body;

    if (!req.files?.length) return res.status(400).json({ error: "No se recibieron imágenes." });

    const targetFormat = (String(target).toLowerCase() || "jpg").replace("jpeg", "jpg");
    const batchId = Date.now().toString(36);
    const batchDir = path.join(OUTPUT_DIR, batchId);
    fs.mkdirSync(batchDir, { recursive: true });

    const results = [];
    for (const f of req.files) {
      const inPath = f.path;
      const outName = changeExt(path.basename(inPath), targetFormat);
      const outPath = path.join(batchDir, outName);

      await convertGeneric(inPath, outPath, {
        target: targetFormat,
        quality,
        pngCompression,
        lossless: String(lossless) === "true",
        resize,
        strip: String(strip) !== "false",
        background: background || "#ffffff"
      });

      const originalSize = fs.statSync(inPath).size;
      const convertedSize = fs.statSync(outPath).size;

      results.push({
        original: path.basename(f.originalname),
        converted: outName,
        originalSize,
        convertedSize,
        saved: Math.max(0, originalSize - convertedSize)
      });

      fs.unlinkSync(inPath);
    }

    if (String(zip) === "true") {
      const zipName = `convert-${targetFormat}-${batchId}.zip`;
      const zipPath = path.join(batchDir, zipName);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      await new Promise((resolve, reject) => {
        output.on("close", resolve);
        archive.on("error", reject);
        archive.pipe(output);
        archive.directory(batchDir, false, entry => (entry.name.endsWith(".zip") ? false : entry));
        archive.finalize();
      });

      return res.json({ batchId, zip: `/download/${batchId}/${zipName}`, results });
    }

    return res.json({
      batchId,
      files: results.map(r => ({ ...r, url: `/download/${batchId}/${r.converted}` }))
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error:
        "Error convirtiendo imágenes. Para HEIC/HEIF instala libheif y reinstala ImageMagick: 'brew install libheif' y luego 'brew reinstall imagemagick'."
    });
  }
});

// ---------- Descargas ----------
app.get("/download/:batchId/:fileName", (req, res) => {
  const { batchId, fileName } = req.params;
  const filePath = path.join(OUTPUT_DIR, batchId, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).send("Archivo no encontrado");
  return res.download(filePath);
});

// ---------- Limpieza lotes > 24h ----------
setInterval(() => {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const batch of fs.readdirSync(OUTPUT_DIR)) {
    const full = path.join(OUTPUT_DIR, batch);
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory() && stat.mtimeMs < cutoff) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    } catch {}
  }
}, 3 * 3600 * 1000);

app.listen(port, () => {
  console.log(`🚀 App unificada en http://localhost:${port}`);
  console.log("👉 Para HEIC: brew install libheif && brew reinstall imagemagick");
});
