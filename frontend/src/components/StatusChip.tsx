import Chip from '@mui/material/Chip'

interface Props {
  mqttConnected?: boolean
  isApproved?: boolean
  size?: 'small' | 'medium'
}

export function StatusChip({ mqttConnected = false, isApproved = true, size = 'small' }: Props) {
  const label = mqttConnected ? 'Online' : 'Offline'
  const color = mqttConnected ? 'success' : 'error'
  const variant = isApproved ? 'filled' : 'outlined'
  const suffix = isApproved ? '' : ' – Nicht registriert'

  return <Chip label={label + suffix} color={color} size={size} variant={variant} />
}
