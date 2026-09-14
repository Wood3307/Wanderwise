import { Navigate, Routes, Route } from 'react-router'
import CanvasPage from './pages/CanvasPage'
import { lazy, Suspense, useEffect } from 'react'
import { initializePersonalSpace, usePersonalStore } from './features/personal/store'
import { connectLegacyInventory } from './features/personal/legacyBridge'
import { connectGalaxyVoyageInbox } from './features/personal/galaxyVoyages'

const HomePage = lazy(() => import('./pages/HomePage'))
const ObservatoryPage = lazy(() => import('./pages/ObservatoryPage'))
const JourneyPage = lazy(() => import('./features/journeys/JourneyPage'))
const LandPage = lazy(() => import('./features/journeys/LandPage'))
const GalaxyPage = lazy(() => import('./features/galaxy'))

export default function App() {
  const ready = usePersonalStore(s => s.ready)
  useEffect(() => {
    let dispose: (() => void) | undefined
    let active = true
    void initializePersonalSpace().then(() => {
      if (!active) return
      const disconnectLegacy = connectLegacyInventory()
      const disconnectVoyages = connectGalaxyVoyageInbox()
      dispose = () => { disconnectVoyages(); disconnectLegacy() }
    })
    return () => { active = false; dispose?.() }
  }, [])
  if (!ready) return <main className="grid min-h-screen place-items-center bg-[#101b25] text-[#e8dcc0]" role="status">正在打开你的思想家园…</main>
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-[#101b25] text-[#e8dcc0]" role="status">正在展开这片风景…</main>}><Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/world" element={<Navigate to="/land" replace />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="/land" element={<Suspense fallback={<main className="grid min-h-screen place-items-center bg-[#192832] text-[#e8dcc0]">正在展开镜海群岛…</main>}><LandPage /></Suspense>} />
      <Route path="/journey/:realmId" element={<Suspense fallback={<main className="grid min-h-screen place-items-center bg-[#192832] text-[#e8dcc0]">杯中的风景正在展开…</main>}><JourneyPage /></Suspense>} />
      <Route path="/canvas" element={<CanvasPage />} />
      <Route path="/observatory" element={<ObservatoryPage />} />
      <Route path="/galaxy" element={<Suspense fallback={<main className="grid min-h-screen place-items-center bg-[#05070f] text-[#e8dcc0]" role="status">正在展开星系…</main>}><GalaxyPage /></Suspense>} />
    </Routes></Suspense>
  )
}
