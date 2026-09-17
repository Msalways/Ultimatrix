# Forced Browsing

## Technique

Access authenticated pages directly without logging in:

1. **Direct URL access**: Navigate to `/dashboard`, `/admin`, `/settings` without authentication
2. **Parameter manipulation**: Access `/user/profile?id=1` with no session
3. **Path fuzzing**: Use wordlists to discover hidden paths:
   - Common admin paths: `/administrator`, `/admin.php`, `/cpanel`, `/phpmyadmin`
   - API docs: `/swagger.json`, `/openapi.json`, `/api-docs`, `/graphql`
   - Backup files: `/backup.zip`, `/db.sql`, `/dump.sql`
4. **Response comparison**: Compare authenticated vs unauthenticated responses:
   - Same 200 response with same body → forced browsing works
   - 200 but body is a redirect/JS → client-side auth only (bypassable)
   - 403 vs 404 → check which is returned for non-existent paths to determine which means "exists but forbidden"
5. **Framework-specific paths**:
   - Next.js: `/_next/data/`, `/api/` routes, `/__nextjs_original_stack_frames`
   - React/Angular: `/static/js/`, `/chunk-vendors.js` — may contain hardcoded routes
   - Spring Boot: `/actuator/env`, `/actuator/health`, `/swagger-ui.html`

## Detection

- Compare response status codes and body sizes between authenticated and unauthenticated requests
- Look for 200 responses that contain user-specific data without authentication
- Check for client-side routing (single-page apps) that may bypass server-side auth checks
