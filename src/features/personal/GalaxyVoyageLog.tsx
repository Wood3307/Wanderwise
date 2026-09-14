import { ArrowUpRight, Compass } from 'lucide-react'
import { usePersonalStore } from './store'
import './galaxy-voyages.css'

const time = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** A readable receipt of visits, not an inferred profile or a new playable recipe. */
export default function GalaxyVoyageLog({ selectedTripId }: { selectedTripId?: string }) {
  const voyages = usePersonalStore(state => state.data.galaxyVoyages)
  const error = usePersonalStore(state => state.error)
  if (!voyages.length) return null
  return <section className="ms-galaxy-voyages" aria-label="已导出的星空漫游足迹">
    <div className="ms-inline"><h3><Compass size={18}/>星空漫游足迹</h3><span className="ms-muted">{voyages.length} 次独立旅行</span></div>
    <p className="ms-muted">只收录你选择导出的旅行。每次出发，星空都会记录一份新的足迹。</p>
    {error && <button type="button" className="ms-button ms-fit" onClick={() => window.dispatchEvent(new Event('wanderwise:journey-retry'))}>重试领取漫游足迹</button>}
    {voyages.map((trip, index) => <details className="ms-galaxy-voyage" key={trip.tripId} data-trip-id={trip.tripId} open={selectedTripId === trip.tripId || (!selectedTripId && index === 0) ? true : undefined}>
      <summary><span className="ms-galaxy-voyage-orbit" aria-hidden="true">{String(voyages.length - index).padStart(2, '0')}</span><span className="ms-grow"><strong>{trip.query || '本次星空漫游'}</strong><span>{time(trip.startedAt)} — {time(trip.endedAt)} · {trip.journey.length} 处足迹</span></span></summary>
      <ol className="ms-galaxy-voyage-stops">
        {[...trip.journey].sort((a, b) => a.visitedAt.localeCompare(b.visitedAt)).map(stop => <li key={stop.id}>
          <div className="ms-galaxy-voyage-stop-meta"><span>{stop.type === 'question' ? '问题' : '回答 / 文章'}</span><time dateTime={stop.visitedAt}>{time(stop.visitedAt)}</time></div>
          <p>{stop.title}</p>
          {stop.query && <span className="ms-muted">当时的探索：{stop.query}</span>}
          {stop.url && <a className="ms-galaxy-voyage-source" href={stop.url} target="_blank" rel="noopener noreferrer">查看原文<ArrowUpRight size={14}/></a>}
        </li>)}
      </ol>
      {!trip.journey.length && <p className="ms-muted">这次旅行尚未进入具体问题或文章。</p>}
    </details>)}
  </section>
}
