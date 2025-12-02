import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import { exec, execFile } from "child_process";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import cors from "cors";
import util from "util";

const execPromise = util.promisify(exec);

const app = express();
const PORT = 3000;



// اگر fluent-ffmpeg می‌خواهی از همین ffmpeg استفاده کند:
try {

} catch (e) {
  console.warn("Could not set ffmpeg path for fluent-ffmpeg:", e.message);
}

app.use(cors());
app.use(express.static("public"));
// multer
const upload = multer({ dest: "uploads/" });

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("converted")) fs.mkdirSync("converted");

// دیباگ سریع: بررسی ffmpeg و libreoffice
app.get("/diag", async (req, res) => {
  try {
    const ffmpegVer = await execPromise(`"${FFMPEG_EXE}" -version`);
    let libre = { ok: false, out: "" };
    try {
      const libOut = await execPromise("soffice --version");
      libre = { ok: true, out: libOut.stdout || libOut.stderr };
    } catch (e) {
      libre = { ok: false, out: e.message };
    }
    res.json({ ffmpeg: ffmpegVer.stdout.split("\n")[0], libreoffice: libre });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// تابع کمکی: تبدیل تصویر با ffmpeg مستقیم (execFile)
function convertImageWithFFmpeg(inputPath, outputPath, target) {
  return new Promise((resolve, reject) => {
    // آرگومان‌ها را بر اساس target تنظیم کن
    let args;
    if (target === "jpg" || target === "jpeg") {
      // image2 + mjpeg encoder
      args = ["-y", "-i", inputPath, "-f", "image2", "-vcodec", "mjpeg", outputPath];
    } else {
      // برای بقیه فرمت‌ها (png, webp, gif...) اجازه بده ffmpeg از پسوند خروجی استفاده کند
      args = ["-y", "-i", inputPath, outputPath];
    }

    // execFile امن‌تر از exec (بدون shell interpolation)
    const child = execFile(FFMPEG_EXE, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        // برگرداندن stderr برای دیباگ
        return reject(new Error(`ffmpeg failed: ${error.message}\n${stderr || stdout}`));
      }
      resolve();
    });

    // برای لاگ زنده (اختیاری)
    child.stdout?.on("data", d => console.log("[ffmpeg stdout]", d.toString()));
    child.stderr?.on("data", d => console.log("[ffmpeg stderr]", d.toString()));
  });
}

app.post("/convert", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const target = (req.body.target || "").toString().trim().toLowerCase();

    if (!file || !target) {
      return res.status(400).send("Bad Request: file and target required");
    }

    const inputPath = file.path;
    const mime = file.mimetype || "";
    const outputName = `${uuid()}.${target}`;
    const outputPath = path.join("converted", outputName);

    console.log(`Convert request: ${file.originalname} (${mime}) -> ${target}`);

    // ---------------------------
    // IMAGE (use execFile ffmpeg for reliability)
    // ---------------------------
    if (mime.startsWith("image/")) {
      try {
        await convertImageWithFFmpeg(inputPath, outputPath, target);
        console.log("Image converted:", outputPath);
        return res.download(outputPath, outputName, err => {
          // پاکسازی فایل‌ها
          try { fs.unlinkSync(inputPath); } catch (e) { }
          try { fs.unlinkSync(outputPath); } catch (e) { }
          if (err) console.error("Error sending file:", err.message);
        });
      } catch (err) {
        console.error("Image conversion failed:", err.message);
        // برای دیباگ دقیق، خطا را به کلاینت هم بفرست (موقت)
        return res.status(500).send("Image conversion failed: " + err.message);
      }
    }

    // ---------------------------
    // AUDIO / VIDEO (fluent-ffmpeg - keep using it)
    // ---------------------------
    if (mime.startsWith("audio/") || mime.startsWith("video/")) {
      // از fluent-ffmpeg برای راحتی استفاده می‌کنیم
      ffmpeg(inputPath)
        .toFormat(target)
        .on("end", () => {
          console.log("A/V converted:", outputPath);
          res.download(outputPath, outputName, () => {
            try { fs.unlinkSync(inputPath); } catch (e) { }
            try { fs.unlinkSync(outputPath); } catch (e) { }
          });
        })
        .on("error", err => {
          console.error("FFmpeg A/V Error:", err);
          res.status(500).send("FFmpeg Error: " + (err.message || err));
        })
        .save(outputPath);

      return;
    }

    
    return res.status(400).send("Unsupported Format");
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).send("Server Error: " + (err.message || err));
  }
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
