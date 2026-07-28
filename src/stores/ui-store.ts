import { create } from 'zustand'

interface UIState {
  sidebarOpen: boolean
  settingsOpen: boolean
  findingsOverlayOpen: boolean
  graphOverlayOpen: boolean
  activeTab: 'chat' | 'findings' | 'graph'

  toggleSidebar: () => void
  openSidebar: () => void
  closeSidebar: () => void

  openSettings: () => void
  closeSettings: () => void

  openFindings: () => void
  closeFindings: () => void

  openGraph: () => void
  closeGraph: () => void

  setActiveTab: (tab: 'chat' | 'findings' | 'graph') => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  settingsOpen: false,
  findingsOverlayOpen: false,
  graphOverlayOpen: false,
  activeTab: 'chat',

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  openFindings: () => set({ findingsOverlayOpen: true }),
  closeFindings: () => set({ findingsOverlayOpen: false }),

  openGraph: () => set({ graphOverlayOpen: true }),
  closeGraph: () => set({ graphOverlayOpen: false }),

  setActiveTab: (tab) => set({ activeTab: tab }),
}))
