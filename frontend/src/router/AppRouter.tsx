import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { AppShell } from '../layout/AppShell'
import { RequirePermission } from './RequirePermission'
import { LoginPage } from '../pages/LoginPage'
import { DashboardPage } from '../pages/DashboardPage'
import { DevicesPage } from '../pages/DevicesPage'
import { DeviceDetailPage } from '../pages/DeviceDetailPage'
import { AnlagenPage } from '../pages/AnlagenPage'
import { AnlageDetailPage } from '../pages/AnlageDetailPage'
import { GroupsPage } from '../pages/GroupsPage'
import { UsersPage } from '../pages/UsersPage'
import { RolesPage } from '../pages/RolesPage'
import { SettingsPage } from '../pages/SettingsPage'
import { VpnPage } from '../pages/VpnPage'

function PrivateRoutes() {
  const { me, isLoading } = useSession()
  if (isLoading) return null
  if (!me) return <Navigate to="/login" replace />
  return <AppShell />
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<PrivateRoutes />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/devices" element={
            <RequirePermission permission="devices:read"><DevicesPage /></RequirePermission>
          } />
          <Route path="/devices/:id" element={
            <RequirePermission permission="devices:read"><DeviceDetailPage /></RequirePermission>
          } />
          <Route path="/anlagen" element={
            <RequirePermission permission="anlagen:read"><AnlagenPage /></RequirePermission>
          } />
          <Route path="/anlagen/:id" element={
            <RequirePermission permission="anlagen:read"><AnlageDetailPage /></RequirePermission>
          } />
          <Route path="/groups" element={
            <RequirePermission permission="groups:read"><GroupsPage /></RequirePermission>
          } />
          <Route path="/users" element={
            <RequirePermission permission="users:read"><UsersPage /></RequirePermission>
          } />
          <Route path="/roles" element={
            <RequirePermission permission="roles:read"><RolesPage /></RequirePermission>
          } />
          <Route path="/settings" element={
            <RequirePermission permission="devices:update"><SettingsPage /></RequirePermission>
          } />
          <Route path="/vpn" element={
            <RequirePermission permission="vpn:manage"><VpnPage /></RequirePermission>
          } />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
