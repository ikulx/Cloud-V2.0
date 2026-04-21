import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import multer from 'multer'
import { authenticate } from '../middleware/authenticate'

const router = Router()

// Generisches Foto-/Datei-Upload-Verzeichnis für Anlage-Todos und -Logs.
// Getrennt vom Wiki (/uploads/wiki/…), damit Rechte und Lifecycle klar
// getrennt bleiben.
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'photos')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 8)
      const safeExt = /^\.[a-z0-9]+$/i.test(ext) ? ext : ''
      cb(null, `${crypto.randomBytes(16).toString('hex')}${safeExt}`)
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB nach Client-Kompression großzügig
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpe?g|gif|webp|heic|heif)$/i.test(file.mimetype)
    if (ok) cb(null, true)
    else cb(new Error('Nur Bilddateien erlaubt'))
  },
})

// POST /api/uploads/photo – gibt { url, name, size, mime } zurück.
router.post('/photo', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) { res.status(400).json({ message: 'Keine Datei' }); return }
  res.status(201).json({
    url: `/uploads/photos/${req.file.filename}`,
    name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
  })
})

export default router
