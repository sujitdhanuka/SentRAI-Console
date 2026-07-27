import { SetMetadata } from '@nestjs/common';

export const VIEWER_WRITABLE_KEY = 'viewerWritable';

/**
 * Opt a mutating route out of the global {@link ViewerReadOnlyGuard}, i.e. allow
 * a VIEWER to POST/PUT/PATCH/DELETE it. VIEWER is the lowest-privilege tier and
 * the role every public self-registration collapses to, so it is read-only
 * across the API by default; mark a handler with `@ViewerWritable()` only when a
 * viewer genuinely needs to write it (none today — provided for future
 * self-service routes such as changing one's own password).
 */
export const ViewerWritable = () => SetMetadata(VIEWER_WRITABLE_KEY, true);
