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
import { AnlagenMapPage } from '../pages/AnlagenMapPage'
import { GroupsPage } from '../pages/GroupsPage'
import { UsersPage } from '../pages/UsersPage'
import { RolesPage } from '../pages/RolesPage'
import { SettingsPage } from '../pages/SettingsPage'
import { VpnPage } from '../pages/VpnPage'
import { UserDashboardPage } from '../pages/UserDashboardPage'
import { AcceptInvitePage } from '../pages/AcceptInvitePage'
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage'
import { ResetPasswordPage } from '../pages/ResetPasswordPage'
import { ActivityLogPage } from '../pages/ActivityLogPage'
import { WikiPage } from '../pages/WikiPage'
import { MyTodosPage } from '../pages/MyTodosPage'
import { PiketAlarmsPage } from '../pages/PiketAlarmsPage'

function PrivateRoutes() {
  const { me, isLoading } = useSession()
  if (isLoading) return null
  if (!me) return <Navigate to="/login" replace />
  return <AppShell />
}

function HomeRoute() {
  const { me } = useSession()
  // Benutzer-Rolle sieht ein eigenes, vereinfachtes Dashboard
  if (me?.roleName === 'benutzer') return <UserDashboardPage />
  return <DashboardPage />
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/invite/:token" element={<AcceptInvitePage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route element={<PrivateRoutes />}>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/devices" element={
            <RequirePermission permission="devices:read"><DevicesPage /></RequirePermission>
          } />
          <Route path="/devices/:id" element={
            <RequirePermission permission="devices:read"><DeviceDetailPage /></RequirePermission>
          } />
          <Route path="/anlagen" element={
            <RequirePermission permission="anlagen:read"><AnlagenPage /></RequirePermission>
          } />
          <Route path="/anlagen/map" element={
            <RequirePermission permission="anlagen:read"><AnlagenMapPage /></RequirePermission>
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
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/vpn" element={
            <RequirePermission permission="vpn:manage"><VpnPage /></RequirePermission>
          } />
          <Route path="/activity-log" element={
            <RequirePermission permission="activityLog:read"><ActivityLogPage /></RequirePermission>
          } />
          <Route path="/wiki" element={
            <RequirePermission permission="wiki:read"><WikiPage /></RequirePermission>
          } />
          <Route path="/my-todos" element={<MyTodosPage />} />
          <Route path="/piket" element={<PiketAlarmsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
