import { useState } from 'react'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Checkbox from '@mui/material/Checkbox'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import InputAdornment from '@mui/material/InputAdornment'
import SearchIcon from '@mui/icons-material/Search'
import { useTranslation } from 'react-i18next'

export interface SelectOption {
  id: string
  label: string
}

interface Props {
  label: string
  options: SelectOption[]
  selected: string[]
  onChange: (ids: string[]) => void
}

export function SearchableMultiSelect({ label, options, selected, onChange }: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  )

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id))
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
        <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </Typography>
        <Typography variant="caption" color="primary.main">
          {selected.length} / {options.length}
        </Typography>
      </Box>
      <TextField
        size="small"
        placeholder={t('common.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        fullWidth
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
        sx={{ mb: 0.5 }}
      />
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          maxHeight: 200,
          overflow: 'auto',
        }}
      >
        {filtered.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
            {t('common.noData')}
          </Typography>
        )}
        <List dense disablePadding>
          {filtered.map((option) => (
            <ListItemButton key={option.id} onClick={() => toggle(option.id)} dense sx={{ py: 0.25 }}>
              <ListItemIcon sx={{ minWidth: 32 }}>
                <Checkbox
                  checked={selected.includes(option.id)}
                  size="small"
                  edge="start"
                  disableRipple
                />
              </ListItemIcon>
              <ListItemText primary={option.label} primaryTypographyProps={{ variant: 'body2' }} />
            </ListItemButton>
          ))}
        </List>
      </Box>
    </Box>
  )
}
