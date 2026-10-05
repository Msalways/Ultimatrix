const ACTOR_IDENTITY_HEADER = /^(?:authorization|proxy-authorization|cookie|x-token|x-apikey|x-(?:auth|session|access|refresh|api|actor)(?:[-_].*)?)$/i

export function isActorIdentityHeader(name: string): boolean {
  return ACTOR_IDENTITY_HEADER.test(name)
}

export function hasActorIdentityHeader(headers: Record<string, string> | undefined): boolean {
  return Object.keys(headers ?? {}).some(isActorIdentityHeader)
}

export function actorIdentityHeaderNames(headers: Record<string, string> | undefined): string[] {
  return Object.keys(headers ?? {}).filter(isActorIdentityHeader)
}

export function stripActorIdentityHeaders(
  headers: Record<string, string>,
  options: { includeCsrfToken?: boolean } = {},
): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) =>
    !isActorIdentityHeader(name) && !(options.includeCsrfToken && /^x-csrf-token$/i.test(name)),
  ))
}
