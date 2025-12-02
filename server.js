import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static("public"));

// multer برای آپلود فایل‌ها
const upload = multer({ dest: "uploads/" });

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("converted")) fs.mkdirSync("converted");

// تابع کمکی: تبدیل تصویر با ffmpeg (استفاده از ffmpeg پیش‌فرض سیستم)
function convertImageWithFFmpeg(inputPath, outputPath, target) {
  return new Promise((resolve, reject) => {
    let args;
    if (target === "jpg" || target === "jpeg") {
      args = ["-y", "-i", inputPath, "-f", "image2", "-vcodec", "mjpeg", outputPath];
    } else {
      args = ["-y", "-i", inputPath, outputPath];
    }

    const child = execFile("ffmpeg", args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`ffmpeg failed: ${error.message}\n${stderr || stdout}`));
      resolve();
    });

    child.stdout?.on("data", d => console.log("[ffmpeg stdout]", d.toString()));
    child.stderr?.on("data", d => console.log("[ffmpeg stderr]", d.toString()));
  });
}

// مسیر تبدیل فایل‌ها
app.post("/convert", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const target = (req.body.target || "").toString().trim().toLowerCase();

    if (!file || !target) return res.status(400).send("Bad Request: file and target required");

    const inputPath = file.path;
    const mime = file.mimetype || "";
    const outputName = `${uuid()}.${target}`;
    const outputPath = path.join("converted", outputName);

    console.log(`Convert request: ${file.originalname} (${mime}) -> ${target}`);

    // ---------------------------
    // IMAGE
    // ---------------------------
    if (mime.startsWith("image/")) {
      try {
        await convertImageWithFFmpeg(inputPath, outputPath, target);
        return res.download(outputPath, outputName, () => {
          try { fs.unlinkSync(inputPath); } catch(e) {}
          try { fs.unlinkSync(outputPath); } catch(e) {}
        });
      } catch (err) {
        console.error("Image conversion failed:", err.message);
        return res.status(500).send("Image conversion failed: " + err.message);
      }
    }

    // ---------------------------
    // AUDIO / VIDEO
    // ---------------------------
    if (mime.startsWith("audio/") || mime.startsWith("video/")) {
      ffmpeg(inputPath)
        .toFormat(target)
        .on("end", () => {
          res.download(outputPath, outputName, () => {
            try { fs.unlinkSync(inputPath); } catch(e) {}
            try { fs.unlinkSync(outputPath); } catch(e) {}
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
