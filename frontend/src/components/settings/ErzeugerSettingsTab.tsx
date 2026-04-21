import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Accordion from '@mui/material/Accordion'
import AccordionSummary from '@mui/material/AccordionSummary'
import AccordionDetails from '@mui/material/AccordionDetails'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Alert from '@mui/material/Alert'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import EditIcon from '@mui/icons-material/Edit'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { apiPatch } from '../../lib/api'
import {
  useErzeugerCategories, useCreateErzeugerCategory, useDeleteErzeugerCategory,
  useCreateErzeugerType, useDeleteErzeugerType,
  type ErzeugerCategory, type ErzeugerType,
} from '../../features/erzeuger-types/queries'

/**
 * Zwei-stufiger Katalog: Kategorie → Typ. Pro Typ lässt sich individuell
 * steuern, ob die Seriennummer obligatorisch ist.
 */
export function ErzeugerSettingsTab() {
  const { data: categories = [] } = useErzeugerCategories()
  const createCat = useCreateErzeugerCategory()
  const deleteCat = useDeleteErzeugerCategory()
  const createType = useCreateErzeugerType()
  const deleteType = useDeleteErzeugerType()
  const qc = useQueryClient()

  const [newCatName, setNewCatName] = useState('')
  const [editingCatId, setEditingCatId] = useState<string | null>(null)
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [newTypeNameByCat, setNewTypeNameByCat] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const patchCategory = async (id: string, data: Partial<Pick<ErzeugerCategory, 'name' | 'sortOrder' | 'isActive'>>) => {
    await apiPatch<ErzeugerCategory>(`/erzeuger-categories/${id}`, data)
    await qc.invalidateQueries({ queryKey: ['erzeuger-categories'] })
    await qc.invalidateQueries({ queryKey: ['erzeuger-types'] })
  }
  const patchType = async (id: string, data: Partial<Pick<ErzeugerType, 'name' | 'isActive' | 'serialRequired' | 'categoryId'>>) => {
    await apiPatch<ErzeugerType>(`/erzeuger-types/${id}`, data)
    await qc.invalidateQueries({ queryKey: ['erzeuger-types'] })
    await qc.invalidateQueries({ queryKey: ['erzeuger-categories'] })
  }

  const addCategory = async () => {
    if (!newCatName.trim()) return
    setMsg(null)
    try {
      const last = categories.reduce((m, c) => Math.max(m, c.sortOrder), 0)
      await createCat.mutateAsync({ name: newCatName.trim(), sortOrder: last + 10 })
      setNewCatName('')
    } catch (e) { setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Fehler' }) }
  }

  const addType = async (catId: string) => {
    const name = (newTypeNameByCat[catId] ?? '').trim()
    if (!name) return
    setMsg(null)
    try {
      const cat = categories.find((c) => c.id === catId)
      const last = cat?.types.reduce((m, t) => Math.max(m, t.sortOrder), 0) ?? 0
      await createType.mutateAsync({
        name, categoryId: catId,
        sortOrder: last + 10,
        serialRequired: true,
      })
      setNewTypeNameByCat((prev) => ({ ...prev, [catId]: '' }))
    } catch (e) { setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Fehler' }) }
  }

  const removeCategory = async (id: string) => {
    setMsg(null)
    try { await deleteCat.mutateAsync(id) }
    catch (e) { setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Fehler' }) }
  }
  const removeType = async (id: string) => {
    setMsg(null)
    try { await deleteType.mutateAsync(id) }
    catch (e) { setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Fehler' }) }
  }

  return (
    <Card sx={{ maxWidth: 860 }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 3 }}>
        <Typography variant="h6">Erzeuger-Katalog</Typography>
        <Typography variant="body2" color="text.secondary">
          Erzeuger sind in <strong>Kategorien</strong> organisiert (z.B. Wärmepumpe).
          Jede Kategorie enthält einen oder mehrere <strong>Typen</strong> (z.B.
          Wärmepumpe XY). Pro Typ lässt sich einstellen, ob die Seriennummer beim
          Hinzufügen zu einer Anlage obligatorisch ist (Standard: ja).
        </Typography>

        {msg && <Alert severity={msg.type}>{msg.text}</Alert>}

        {categories.map((cat) => (
          <Accordion key={cat.id} defaultExpanded={cat.types.length === 0}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              {editingCatId === cat.id ? (
                <Box sx={{ display: 'flex', gap: 0.5, flex: 1, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                  <TextField
                    size="small"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { void patchCategory(cat.id, { name: editText.trim() }); setEditingCatId(null) }
                    }}
                  />
                  <IconButton size="small" onClick={() => { void patchCategory(cat.id, { name: editText.trim() }); setEditingCatId(null) }}>
                    <CheckIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => setEditingCatId(null)}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                  <Typography sx={{ fontWeight: 600, opacity: cat.isActive ? 1 : 0.5 }}>
                    {cat.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    ({cat.types.length} Typ{cat.types.length === 1 ? '' : 'en'})
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Box onClick={(e) => e.stopPropagation()} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Switch
                      size="small"
                      checked={cat.isActive}
                      onChange={(e) => void patchCategory(cat.id, { isActive: e.target.checked })}
                    />
                    <IconButton size="small" onClick={() => { setEditingCatId(cat.id); setEditText(cat.name) }}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => removeCategory(cat.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              )}
            </AccordionSummary>
            <AccordionDetails>
              <List dense disablePadding>
                {cat.types.map((t) => (
                  <ListItem
                    key={t.id}
                    sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
                    secondaryAction={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {editingTypeId === t.id ? (
                          <>
                            <TextField
                              size="small"
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { void patchType(t.id, { name: editText.trim() }); setEditingTypeId(null) }
                              }}
                            />
                            <IconButton size="small" onClick={() => { void patchType(t.id, { name: editText.trim() }); setEditingTypeId(null) }}>
                              <CheckIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" onClick={() => setEditingTypeId(null)}>
                              <CloseIcon fontSize="small" />
                            </IconButton>
                          </>
                        ) : (
                          <>
                            <FormControlLabel
                              control={
                                <Switch
                                  size="small"
                                  checked={t.serialRequired}
                                  onChange={(e) => void patchType(t.id, { serialRequired: e.target.checked })}
                                />
                              }
                              label={<Typography variant="caption">SN Pflicht</Typography>}
                              labelPlacement="start"
                              sx={{ mr: 0 }}
                            />
                            <Switch
                              size="small"
                              checked={t.isActive}
                              onChange={(e) => void patchType(t.id, { isActive: e.target.checked })}
                            />
                            <IconButton size="small" onClick={() => { setEditingTypeId(t.id); setEditText(t.name) }}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" onClick={() => removeType(t.id)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </>
                        )}
                      </Box>
                    }
                  >
                    <ListItemText
                      primary={t.name}
                      secondary={!t.isActive ? 'inaktiv' : undefined}
                      primaryTypographyProps={{ sx: { opacity: t.isActive ? 1 : 0.5 } }}
                    />
                  </ListItem>
                ))}
                {cat.types.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1, px: 2 }}>
                    Noch kein Typ in dieser Kategorie.
                  </Typography>
                )}
              </List>
              <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <TextField
                  size="small"
                  label="Neuer Typ"
                  value={newTypeNameByCat[cat.id] ?? ''}
                  onChange={(e) => setNewTypeNameByCat((p) => ({ ...p, [cat.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addType(cat.id) }}
                  fullWidth
                />
                <Button startIcon={<AddIcon />} onClick={() => addType(cat.id)}>Hinzufügen</Button>
              </Box>
            </AccordionDetails>
          </Accordion>
        ))}

        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <TextField
            size="small"
            label="Neue Kategorie"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addCategory() }}
            fullWidth
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={addCategory} disabled={createCat.isPending}>
            Kategorie
          </Button>
        </Box>
      </CardContent>
    </Card>
  )
}
