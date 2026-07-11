import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route (or controller) as publicly accessible, bypassing the global
 * JwtAuthGuard. Mirrors the FastAPI routes that are not wrapped in
 * Depends(get_required_user) (login, refresh, register, health, root, docs,
 * sutras, static assets).
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
