import type { ThoughtRecipe } from '../../components/observatory/gardenRecipes'
import type { JourneyExportPacket } from '../galaxy/lib/trip'

/** A deliberately exported galaxy visit, separate from playable recipe journeys. */
export type GalaxyVoyage = JourneyExportPacket

export interface ContentSource {
  contentType?: 'answer'|'question'|'article'|'webpage'
  id: string
  remoteId?: string
  title: string
  author: string
  summary: string
  url: string
  source: string
  kind: 'summary' | 'article' | 'question' | 'excerpt' | 'curated'
  fetchedAt: string
  tags?: string[]
  readingGuide?: string
  legacyWorkId?: string
  galaxy?: { id: string; type: 'question' | 'answer'; questionId: string; answerId?: string; query: string }
}
export interface CollectionRecord { id: string; sourceId: string; excerpt: string; createdAt: string; legacyId?: string }
export interface PersonalNote { id: string; sourceId?: string; title: string; text: string; quote?: string; createdAt: string; updatedAt: string }
export interface PersonalWork { id: string; title: string; text: string; sourceIds: string[]; journeyId?: string; createdAt: string; kind: 'idea' | 'journey' }
export interface ScenePose { position: [number, number, number]; yaw: number; pitch: number }
export interface SceneReturnAnchor { route: '/observatory' | '/land' | `/journey/${string}`; label: string; journeyId?: string; stationId?: string; sourceId?: string; pose?: ScenePose }
export interface JourneyProgress { visited: string[]; drafts: Record<string, string>; completed: boolean; pose?: ScenePose; activeStation?: string }
export interface JourneyInstance { id: string; realmId: string; title: string; recipe: ThoughtRecipe; personalText: string; contentVersion: number; sourceIds: string[]; createdAt: string; progress: JourneyProgress }
export interface PersonalData {
  version: 1
  migrated: boolean
  /** Applied public starter batches; retained after deleting their collections. */
  collectionSeedVersions?: string[]
  reading?: Record<string, { paragraph: number; updatedAt: string }>
  sources: Record<string, ContentSource>
  collections: CollectionRecord[]
  notes: PersonalNote[]
  works: PersonalWork[]
  journeys: JourneyInstance[]
  galaxyVoyages: GalaxyVoyage[]
  recipes: ThoughtRecipe[]
  interests: string[]
  returnAnchor: SceneReturnAnchor | null
  poses: Record<string, ScenePose>
  settings: { mascotAnimated: boolean; mascotHints: boolean; muted: boolean }
  legacy: Record<string, unknown>
}
