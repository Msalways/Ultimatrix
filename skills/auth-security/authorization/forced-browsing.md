# Forced Browsing

## Technique

Access authenticated pages directly without logging in:

1. **Direct route access**: Use a page, API route, or action observed in the target UI, delivered client code, or captured traffic; compare access with and without authentication.
2. **Parameter manipulation**: Change a value in a captured request while preserving its observed route and method.
3. **Path discovery**: Do not guess conventional paths or use wordlists. Record hidden routes as unknown until the target supplies them through a link, response, client code, or explicit operator authorization.
4. **Response comparison**: Compare authenticated vs unauthenticated responses:
   - Same 200 response with same body → forced browsing works
   - 200 but body is a redirect/JS → client-side auth only (bypassable)
   - 403 vs 404 → check which is returned for non-existent paths to determine which means "exists but forbidden"
5. **Framework clues**: Follow framework resource URLs actually present in captured HTML or network traffic; do not construct conventional framework paths.

## Detection

- Compare response status codes and body sizes between authenticated and unauthenticated requests
- Look for 200 responses that contain user-specific data without authentication
- Check for client-side routing (single-page apps) that may bypass server-side auth checks
