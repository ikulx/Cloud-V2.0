import { useState, type ReactElement } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Stack from '@mui/material/Stack'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import Alert from '@mui/material/Alert'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import MapIcon from '@mui/icons-material/Map'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import HistoryIcon from '@mui/icons-material/History'
import { usePiketAlarms, useAckPiketAlarm, type PiketAlarm, type PiketAlarmState } from '../features/piket/queries'
import { useSession } from '../context/SessionContext'
import { usePermission } from '../hooks/usePermission'
import { useTranslation } from 'react-i18next'
import { RegionsPanel, ShiftsPanel, LogPanel } from '../components/settings/PiketManagerAdmin'

const STATE_COLOR: Record<PiketAlarmState, 'default' | 'warning' | 'error' | 'success' | 'info'> = {
  PENDING_SMS: 'info',
  SMS_SENT:    'info',
  CALL_DUE:    'warning',
  CALL_SENT:   'warning',
  LEADER_DUE:  'error',
  LEADER_SENT: 'error',
  ACKNOWLEDGED:'success',
  NO_TECH_FOUND:'error',
}

export function PiketAlarmsPage() {
  const { me } = useSession()
  void me
  const { t } = useTranslation()
  const canReadOwn  = usePermission('piket:alarms:read_own')
  const canReadAll  = usePermission('piket:alarms:read_all')
  const canPlanning = usePermission('piket:planning:manage')
  const canLog      = usePermission('piket:log:read')
  const canAlarms   = canReadOwn || canReadAll

  // Dynamische Tabs: pro Permission ein Eintrag
  const tabs: { key: string; label: string; icon: ReactElement; render: () => ReactElement }[] = []
  if (canAlarms)   tabs.push({ key: 'active',   label: t('piket.tabs.active'),  icon: <NotificationsActiveIcon fontSize="small" />, render: () => <ActiveAlarmsPanel canReadAll={canReadAll} /> })
  if (canPlanning) tabs.push({ key: 'regions',  label: t('piket.tabs.regions'), icon: <MapIcon fontSize="small" />,                 render: () => <RegionsPanel /> })
  if (canPlanning) tabs.push({ key: 'shifts',   label: t('piket.tabs.shifts'),  icon: <CalendarMonthIcon fontSize="small" />,       render: () => <ShiftsPanel /> })
  if (canLog)      tabs.push({ key: 'log',      label: t('piket.tabs.log'),     icon: <HistoryIcon fontSize="small" />,             render: () => <LogPanel /> })

  const [tab, setTab] = useState(0)
  const safeTab = Math.min(tab, Math.max(0, tabs.length - 1))

  if (tabs.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>{t('piket.title')}</Typography>
        <Alert severity="warning">{t('piket.noPermission')}</Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>{t('piket.title')}</Typography>
      <Tabs
        value={safeTab}
        onChange={(_, v) => setTab(v)}
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}
      >
        {tabs.map((t) => (
          <Tab key={t.key} icon={t.icon} iconPosition="start" label={t.label} />
        ))}
      </Tabs>
      {tabs[safeTab]?.render()}
    </Box>
  )
}

function ActiveAlarmsPanel({ canReadAll }: { canReadAll: boolean }) {
  const { t } = useTranslation()
  // User mit read_all kann zwischen "alle" und "nur meine" wechseln; wer nur
  // read_own hat, sieht immer nur seine eigenen.
  const [mine, setMine] = useState(!canReadAll)
  const { data: alarms = [], isLoading } = usePiketAlarms(mine)
  const ack = useAckPiketAlarm()

  return (
    <Box>
      {canReadAll && (
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
          <FormControlLabel
            control={<Switch checked={mine} onChange={(e) => setMine(e.target.checked)} />}
            label={t('piket.onlyMine')}
          />
        </Stack>
      )}

      {isLoading ? (
        <Typography variant="body2" color="text.secondary">{t('common.loading')}</Typography>
      ) : alarms.length === 0 ? (
        <Alert severity="success">{t('piket.noActive')}</Alert>
      ) : (
        <Stack gap={2}>
          {alarms.map((a) => (
            <PiketAlarmCard key={a.id} alarm={a} onAck={() => void ack.mutate(a.id)} ackPending={ack.isPending} />
          ))}
        </Stack>
      )}
    </Box>
  )
}

function PiketAlarmCard({ alarm, onAck, ackPending }: { alarm: PiketAlarm; onAck: () => void; ackPending: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'de-CH'
  const e = alarm.alarmEvent
  const activated = new Date(e.activatedAt).toLocaleString(locale)
  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Chip size="small" color={STATE_COLOR[alarm.state]} label={t(`piket.states.${alarm.state}`)} />
              <Chip size="small" variant="outlined" label={e.priority} />
              {alarm.region && <Chip size="small" variant="outlined" label={`${t('piket.region')}: ${alarm.region.name}`} />}
            </Stack>
            <Typography variant="subtitle1" fontWeight={600}>
              {e.anlage ? `${e.anlage.name}${e.anlage.projectNumber ? ' (' + e.anlage.projectNumber + ')' : ''}` : '—'}
            </Typography>
            <Typography variant="body2">{e.message}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {t('piket.device')}: {e.device.name} · {t('piket.activatedAt')}: {activated}
              {alarm.techUser && <> · {t('piket.technician')}: {alarm.techUser.firstName} {alarm.techUser.lastName}</>}
              {alarm.leaderUser && <> · {t('piket.leader')}: {alarm.leaderUser.firstName} {alarm.leaderUser.lastName}</>}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {alarm.smsAt    && <>SMS: {new Date(alarm.smsAt).toLocaleTimeString(locale)} </>}
              {alarm.callAt   && <>· Anruf: {new Date(alarm.callAt).toLocaleTimeString(locale)} </>}
              {alarm.leaderAt && <>· {t('piket.leader')}: {new Date(alarm.leaderAt).toLocaleTimeString(locale)} </>}
              {alarm.nextActionAt && <>· {t('piket.nextAction')}: {new Date(alarm.nextActionAt).toLocaleTimeString(locale)}</>}
            </Typography>
          </Box>
          <Button variant="contained" color="success" disabled={ackPending} onClick={onAck}>
            {t('piket.acknowledge')}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )
}
