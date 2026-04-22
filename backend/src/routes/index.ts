import { Router } from 'express'
import authRouter from './auth.router'
import meRouter from './me.router'
import usersRouter from './users.router'
import rolesRouter from './roles.router'
import permissionsRouter from './permissions.router'
import groupsRouter from './groups.router'
import anlagenRouter from './anlagen.router'
import devicesRouter from './devices.router'
import settingsRouter from './settings.router'
import vpnRouter from './vpn.router'
import invitationsRouter from './invitations.router'
import activityLogRouter from './activity-log.router'
import wikiRouter from './wiki.router'
import erzeugerTypesRouter from './erzeuger-types.router'
import erzeugerCategoriesRouter from './erzeuger-categories.router'
import uploadsRouter from './uploads.router'
import alarmsRouter from './alarms.router'
import internalAlarmTemplatesRouter from './internal-alarm-templates.router'
import holidaysRouter from './holidays.router'
import piketRouter from './piket.router'

const router = Router()

router.use('/auth', authRouter)
router.use('/me', meRouter)
router.use('/users', usersRouter)
router.use('/roles', rolesRouter)
router.use('/permissions', permissionsRouter)
router.use('/groups', groupsRouter)
router.use('/anlagen', anlagenRouter)
router.use('/devices', devicesRouter)
router.use('/settings', settingsRouter)
router.use('/vpn', vpnRouter)
router.use('/invitations', invitationsRouter)
router.use('/activity-log', activityLogRouter)
router.use('/wiki', wikiRouter)
router.use('/erzeuger-types', erzeugerTypesRouter)
router.use('/erzeuger-categories', erzeugerCategoriesRouter)
router.use('/uploads', uploadsRouter)
router.use('/alarms', alarmsRouter)
router.use('/alarms/internal-templates', internalAlarmTemplatesRouter)
router.use('/alarms/holidays', holidaysRouter)
router.use('/piket', piketRouter)

export default router
