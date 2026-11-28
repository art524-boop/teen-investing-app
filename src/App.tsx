import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { FamilyDataProvider } from './lib/familyData'
import { configured } from './lib/supabase'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui'
import Start from './pages/Start'
import Privacy from './pages/Privacy'
import ParentSignUp from './pages/parent/SignUp'
import ParentLogin from './pages/parent/Login'
import ParentTwoStep from './pages/parent/TwoStep'
import ParentHome from './pages/parent/Home'
import AddTeen from './pages/parent/AddTeen'
import Account from './pages/parent/Account'
import TeenJoin from './pages/teen/Join'
import TeenLogin from './pages/teen/Login'
import Garden from './pages/teen/Garden'
import TeenTasks from './pages/teen/Tasks'
import TeenCredits from './pages/teen/Credits'
import Approvals from './pages/parent/Approvals'
import FamilySettings from './pages/parent/FamilySettings'

/** Parent pages need a parent login AND the authenticator code for this session. */
function RequireParent({ children }: { children: ReactNode }) {
  const { loading, session, role, aal } = useAuth()
  if (loading) return <Spinner />
  if (!session || role !== 'parent') return <Navigate to="/parent/login" replace />
  if (aal !== 'aal2') return <Navigate to="/parent/two-step" replace />
  return <>{children}</>
}

function RequireTeen({ children }: { children: ReactNode }) {
  const { loading, session, role } = useAuth()
  if (loading) return <Spinner />
  if (!session || role !== 'teen') return <Navigate to="/teen/login" replace />
  return <>{children}</>
}

/** Signed-in areas share one live copy of the family's data. */
function ParentArea() {
  return <RequireParent><FamilyDataProvider><Outlet /></FamilyDataProvider></RequireParent>
}
function TeenArea() {
  return <RequireTeen><FamilyDataProvider><Outlet /></FamilyDataProvider></RequireTeen>
}

function NotConfigured() {
  return (
    <Layout side="neutral" title="Setup needed">
      <h1>Almost there</h1>
      <p>This copy of the app is missing its Supabase settings. Copy <code>.env.example</code> to <code>.env</code> and fill it in.</p>
    </Layout>
  )
}

export default function App() {
  if (!configured) return <NotConfigured />
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Start />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/parent/signup" element={<ParentSignUp />} />
          <Route path="/parent/login" element={<ParentLogin />} />
          <Route path="/parent/two-step" element={<ParentTwoStep />} />
          <Route element={<ParentArea />}>
            <Route path="/parent" element={<ParentHome />} />
            <Route path="/parent/approvals" element={<Approvals />} />
            <Route path="/parent/family" element={<FamilySettings />} />
            <Route path="/parent/add-teen" element={<AddTeen />} />
            <Route path="/parent/account" element={<Account />} />
          </Route>
          <Route path="/teen/join" element={<TeenJoin />} />
          <Route path="/teen/login" element={<TeenLogin />} />
          <Route element={<TeenArea />}>
            <Route path="/teen" element={<Garden />} />
            <Route path="/teen/tasks" element={<TeenTasks />} />
            <Route path="/teen/credits" element={<TeenCredits />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
