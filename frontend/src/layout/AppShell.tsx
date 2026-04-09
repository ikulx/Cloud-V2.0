import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

const DRAWER_WIDTH = 240

export function AppShell() {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            borderRight: '1px solid',
            borderColor: 'divider',
            bgcolor: 'primary.dark',
          },
        }}
      >
        <Sidebar />
      </Drawer>

      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <TopBar />
        <Box
          component="main"
          sx={{ flexGrow: 1, p: 3, bgcolor: 'background.default', overflow: 'auto' }}
        >
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}
