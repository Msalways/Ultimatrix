'use client'

import dynamic from 'next/dynamic'

const HomeClient = dynamic(() => import('./home-client').then(m => m.default), { ssr: false })

export function ClientEntry() {
  return <HomeClient />
}
