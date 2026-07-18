import { useState } from 'react'
import SiteNav from './components/SiteNav'
import SiteFooter from './components/SiteFooter'
import BottleList from './components/BottleList'
import BottleDetail from './components/BottleDetail'
import BottleForm from './components/BottleForm'
import AuthModal from './components/AuthModal'
import { AuthProvider } from './components/AuthContext'
import { useRoute } from './lib/router'
import { USE_MOCK } from './lib/api'

function Routed({ onRequireAuth }: { onRequireAuth: () => void }) {
  const route = useRoute()
  // Keys reset per-screen state (form fields, open note form, in-flight data)
  // when navigating between instances of the same component — e.g. detail ->
  // detail via a recommendation, or add -> edit.
  switch (route.name) {
    case 'detail':
      return (
        <BottleDetail
          key={route.id}
          id={route.id}
          onRequireAuth={onRequireAuth}
        />
      )
    case 'add':
      return <BottleForm key={`add-${route.family}`} initialFamily={route.family} />
    case 'edit':
      return <BottleForm key={`edit-${route.id}`} editId={route.id} />
    case 'list':
    default:
      // Keyed by family so hopping between the cabinet and the coffee bar
      // resets search + filters (their vocabularies don't overlap).
      return (
        <BottleList
          key={route.family}
          family={route.family}
          onRequireAuth={onRequireAuth}
        />
      )
  }
}

function Inner() {
  const [authOpen, setAuthOpen] = useState(false)
  const route = useRoute()

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteNav
        badge={USE_MOCK ? 'mock API · demo data' : 'live API'}
        active={route.name === 'list' ? route.family : undefined}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pt-[76px] pb-6 sm:px-8">
        <Routed onRequireAuth={() => setAuthOpen(true)} />

        <SiteFooter
          note={
            USE_MOCK
              ? 'Running on the in-browser mock API — every write stays local.'
              : undefined
          }
          onSignIn={() => setAuthOpen(true)}
        />
      </main>

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Inner />
    </AuthProvider>
  )
}
