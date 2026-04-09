import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'

const router = Router()

// GET /api/me
router.get('/', authenticate, (req, res) => {
  res.json(req.user)
})

export default router
