import { PROVIDER_INFO } from '@/config'

export async function GET() {
  return Response.json(PROVIDER_INFO)
}
