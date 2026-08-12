import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { isSupabaseConfigured } from './lib/supabase'
import { AppLayout } from './components/Layout'
import { RequireAuth } from './components/Guards'
import { LoginPage } from './pages/auth/LoginPage'
import { SignupPage } from './pages/auth/SignupPage'
import { HomePage } from './pages/HomePage'
import { EventCreatePage } from './pages/events/EventCreatePage'
import { EventLayout } from './pages/events/EventLayout'
import { OverviewPage } from './pages/events/OverviewPage'
import { LeaderboardPage } from './pages/events/LeaderboardPage'
import { DashboardPage } from './pages/events/DashboardPage'
import { ScanPage } from './pages/events/ScanPage'
import { ActivitiesPage } from './pages/events/ActivitiesPage'
import { MembersPage } from './pages/events/MembersPage'
import { SettingsPage } from './pages/events/SettingsPage'
import { PublicLeaderboardPage } from './pages/public/PublicLeaderboardPage'

function SetupScreen() {
  return (
    <div className="setup-screen">
      <h1>EMP — Event Management Platform</h1>
      <p>Supabase is not configured yet.</p>
      <ol>
        <li>Create a Supabase project and run <code>supabase/migrations/00001_init.sql</code>.</li>
        <li>Copy <code>.env.example</code> to <code>.env</code> and fill in
          <code> VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.</li>
        <li>Restart <code>npm run dev</code>.</li>
      </ol>
    </div>
  )
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupScreen />

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* public, anonymous leaderboard */}
          <Route path="/e/:slug/leaderboard" element={<PublicLeaderboardPage />} />

          <Route element={<AppLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/events/new" element={<EventCreatePage />} />
              <Route path="/events/:eventId" element={<EventLayout />}>
                <Route index element={<OverviewPage />} />
                <Route path="leaderboard" element={<LeaderboardPage />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="scan" element={<ScanPage />} />
                <Route path="activities" element={<ActivitiesPage />} />
                <Route path="members" element={<MembersPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
