import { useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import TextField from '@mui/material/TextField'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import InputAdornment from '@mui/material/InputAdornment'
import SearchIcon from '@mui/icons-material/Search'
import CircularProgress from '@mui/material/CircularProgress'
import { useWikiSearch } from '../../features/wiki/queries'

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (id: string) => void
}

export function WikiSearchDialog({ open, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const { data: hits, isFetching } = useWikiSearch(query)

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <Box sx={{ p: 2 }}>
        <TextField
          placeholder="Seiten durchsuchen …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          fullWidth
          autoFocus
          variant="outlined"
          size="small"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                {isFetching ? <CircularProgress size={16} /> : <SearchIcon />}
              </InputAdornment>
            ),
          }}
        />
      </Box>

      <Box sx={{ maxHeight: 400, overflowY: 'auto', pb: 1 }}>
        {query.trim().length < 2 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 4, textAlign: 'center' }}>
            Mindestens 2 Zeichen eingeben.
          </Typography>
        ) : hits && hits.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 4, textAlign: 'center' }}>
            Keine Treffer für „{query}".
          </Typography>
        ) : (
          <List dense disablePadding>
            {hits?.map((hit) => (
              <ListItemButton
                key={hit.id}
                onClick={() => { onSelect(hit.id); onClose() }}
              >
                <ListItemText
                  primary={
                    <>
                      {hit.icon && <span style={{ marginRight: 6 }}>{hit.icon}</span>}
                      {hit.title}
                    </>
                  }
                  secondary={hit.excerpt || '—'}
                  primaryTypographyProps={{ fontWeight: 500 }}
                  secondaryTypographyProps={{ noWrap: true, fontSize: 12 }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
    </Dialog>
  )
}
