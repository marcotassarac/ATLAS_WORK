// DEF-11: subida segura de documentos de contrato (RF-5.2; OWASP A04:2021, CWE-434, CWE-770).
// - Límite de 10 MB por archivo y un solo archivo por solicitud (413 si se excede).
// - Solo los formatos del RF-5.2: PDF, DOC/DOCX, PPT/PPTX, JPG y PNG (415 si no).
// - Se verifica la firma binaria del contenido: la extensión y el tipo MIME los
//   decide el cliente y se pueden falsificar (un .exe renombrado a .pdf).
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const TAMANO_MAXIMO = 10 * 1024 * 1024;

const FIRMAS = {
  pdf: [Buffer.from("%PDF")],
  zip: [Buffer.from([0x50, 0x4b, 0x03, 0x04])], // DOCX y PPTX (Office Open XML)
  ole: [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])], // DOC y PPT
  jpg: [Buffer.from([0xff, 0xd8, 0xff])],
  png: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
};

const PERMITIDOS = {
  ".pdf": { mime: "application/pdf", firma: "pdf" },
  ".doc": { mime: "application/msword", firma: "ole" },
  ".docx": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", firma: "zip" },
  ".ppt": { mime: "application/vnd.ms-powerpoint", firma: "ole" },
  ".pptx": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", firma: "zip" },
  ".jpg": { mime: "image/jpeg", firma: "jpg" },
  ".jpeg": { mime: "image/jpeg", firma: "jpg" },
  ".png": { mime: "image/png", firma: "png" },
};

class ArchivoNoPermitido extends Error {}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO, files: 1, fields: 20 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!PERMITIDOS[ext]) return cb(new ArchivoNoPermitido("extension"));
    return cb(null, true);
  },
});

function firmaCoincide(buffer, familia) {
  return FIRMAS[familia].some((f) => buffer.length >= f.length && buffer.subarray(0, f.length).equals(f));
}

function rechazar(res, status, glosa) {
  return res.status(status).json({ error: status === 413 ? "Archivo demasiado grande" : "Tipo de archivo no permitido", glosa });
}

const MENSAJE_TIPOS = "Formatos permitidos: PDF, DOC, DOCX, PPT, PPTX, JPG y PNG.";

// Middleware: procesa el campo "file" y deja en req.documento los datos validados
function subirDocumento(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return rechazar(res, 413, "El documento supera el máximo de 10 MB.");
    }
    if (err instanceof ArchivoNoPermitido) return rechazar(res, 415, MENSAJE_TIPOS);
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: "Datos inválidos", glosa: "La carga del archivo no es válida (un solo archivo por contrato)." });
    }
    if (err) return next(err);
    if (!req.file) return next();
    const ext = path.extname(req.file.originalname).toLowerCase();
    const tipo = PERMITIDOS[ext];
    if (!firmaCoincide(req.file.buffer, tipo.firma)) {
      return rechazar(res, 415, `El contenido del archivo no corresponde a un ${ext.slice(1).toUpperCase()}. ${MENSAJE_TIPOS}`);
    }
    const base = path.basename(req.file.originalname, ext).replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]/g, "_").slice(0, 100) || "documento";
    req.documento = {
      buffer: req.file.buffer,
      nombre: `${base}${ext}`,
      mime: tipo.mime,
      tamano: req.file.size,
      sha256: crypto.createHash("sha256").update(req.file.buffer).digest("hex"),
    };
    return next();
  });
}

module.exports = { subirDocumento, TAMANO_MAXIMO };
