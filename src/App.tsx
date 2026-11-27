import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
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
          <Route path="/parent" element={<RequireParent><ParentHome /></RequireParent>} />
          <Route path="/parent/add-teen" element={<RequireParent><AddTeen /></RequireParent>} />
          <Route path="/parent/account" element={<RequireParent><Account /></RequireParent>} />
          <Route path="/teen/join" element={<TeenJoin />} />
          <Route path="/teen/login" element={<TeenLogin />} />
          <Route path="/teen" element={<RequireTeen><Garden /></RequireTeen>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
