import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Define which routes should require authentication.
// Currently targeting the main dashboard, cashflow pages, and all APIs.
// Excludes public routes like /, /sign-in, /sign-up
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/cashflow(.*)",
  "/audit(.*)",
  "/recurring(.*)",
  "/cash-adjustments(.*)",
  "/api/(.*)"
]);

export default clerkMiddleware(async (auth, req) => {
  // Feature flag to safely roll out Auth Protection.
  // When false (production default for now), it acts as a ghost layer (Step 1 behavior).
  // When true (local testing), it strictly enforces login for protected routes.
  if (process.env.NEXT_PUBLIC_REQUIRE_AUTH === "true" && isProtectedRoute(req)) {
      await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
