// /api/templates — GET (list templates with search + filter + sort)
//
// V19 §7: Template discovery — search + filter + sort + categories.
// V19 §8: Real ranking via computeTemplateRank (not fake popularity).
// V19 §9: Returns preview metadata (thumbnail, duration, slots, creator).
//
// Query params:
//   - q: search query (matches title + description + tags)
//   - category: filter by category (Social, Lifestyle, Events, Business, Creator, Visual Styles, Music)
//   - subcategory: filter by subcategory
//   - tier: filter by tier (free, premium, etc.)
//   - sort: 'trending' | 'popular' | 'newest' | 'recommended'
//   - limit: max results (default 20)
//   - offset: pagination offset

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { BUILTIN_TEMPLATES, computeTemplateRank } from '@/lib/templates/builtin-templates';
import type { TemplateDefinition } from '@/lib/templates';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.toLowerCase() || '';
  const category = url.searchParams.get('category') || '';
  const subcategory = url.searchParams.get('subcategory') || '';
  const tier = url.searchParams.get('tier') || '';
  const sort = url.searchParams.get('sort') || 'trending';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

  // === V19 §7: Search + filter ===
  // Start with builtin templates (no DB needed for them).
  let builtinResults: any[] = BUILTIN_TEMPLATES.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    category: t.category,
    subcategory: t.subcategory,
    tags: t.tags,
    thumbnailUrl: t.thumbnailUrl,
    aspectRatio: t.aspectRatio,
    duration: t.duration,
    slotCount: t.slots.length,
    tier: t.tier,
    isBuiltin: true,
    creator: t.creator || null,
    usageCount: 0, // builtins don't have DB metrics by default
    likeCount: 0,
    saveCount: 0,
    rank: 0, // will compute below
  }));

  // V19 §8: For builtin templates, query the DB for actual usage metrics
  // (they may have DB rows if a user has used them).
  try {
    const dbBuiltinTemplates = await db.template.findMany({
      where: { isBuiltin: true, status: 'published' },
      select: {
        id: true, usageCount: true, likeCount: true, saveCount: true,
        shareCount: true, viewCount: true, completionRate: true, publishedAt: true,
      },
    });
    const dbMetricsById = new Map(dbBuiltinTemplates.map((t) => [t.id, t]));
    builtinResults = builtinResults.map((t) => {
      const m = dbMetricsById.get(t.id);
      if (m) {
        t.usageCount = m.usageCount;
        t.likeCount = m.likeCount;
        t.saveCount = m.saveCount;
        t.rank = computeTemplateRank({
          usageCount: m.usageCount, likeCount: m.likeCount, saveCount: m.saveCount,
          shareCount: m.shareCount, completionRate: m.completionRate,
          publishedAt: m.publishedAt,
        });
      }
      return t;
    });
  } catch {
    // DB might not be available — return builtins with zero metrics.
  }

  // V19 §7: Fetch creator templates from DB
  let dbResults: any[] = [];
  try {
    // V19 §11: Templates reference a User (creatorId) OR a CreatorProfile.
    // We fetch the creator profile separately if it exists.
    const dbTemplates = await db.template.findMany({
      where: {
        status: 'published',
        ...(category ? { category } : {}),
        ...(subcategory ? { subcategory } : {}),
        ...(tier ? { tier } : {}),
      },
      orderBy: sort === 'newest'
        ? { publishedAt: 'desc' }
        : sort === 'popular'
        ? { usageCount: 'desc' }
        : { publishedAt: 'desc' },
      take: limit + offset,
    });
    // V19 §11: Fetch creator profiles for these templates in a separate query
    // (avoids N+1 + handles the case where creatorProfileId is null for builtins).
    const creatorProfileIds = dbTemplates
      .map((t) => t.creatorProfileId)
      .filter((id): id is string => !!id);
    const profiles = creatorProfileIds.length > 0
      ? await db.creatorProfile.findMany({
          where: { id: { in: creatorProfileIds } },
          select: { id: true, displayName: true, avatarUrl: true, verified: true },
        })
      : [];
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    dbResults = dbTemplates.map((t) => {
      const slots = JSON.parse(t.slots || '[]');
      const profile = t.creatorProfileId ? profileById.get(t.creatorProfileId) : null;
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        category: t.category,
        subcategory: t.subcategory,
        tags: JSON.parse(t.tags || '[]'),
        thumbnailUrl: t.thumbnailUrl,
        aspectRatio: t.aspectRatio,
        duration: t.duration,
        slotCount: slots.length,
        tier: t.tier,
        isBuiltin: false,
        creator: profile ? {
          id: profile.id,
          name: profile.displayName,
          avatarUrl: profile.avatarUrl,
          verified: profile.verified,
        } : null,
        usageCount: t.usageCount,
        likeCount: t.likeCount,
        saveCount: t.saveCount,
        rank: computeTemplateRank({
          usageCount: t.usageCount, likeCount: t.likeCount, saveCount: t.saveCount,
          shareCount: t.shareCount, completionRate: t.completionRate,
          publishedAt: t.publishedAt,
        }),
      };
    });
  } catch {
    // DB unavailable — return builtins only.
  }

  let all = [...builtinResults, ...dbResults];

  // V19 §7: Search filter
  if (q) {
    all = all.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      (t.description?.toLowerCase().includes(q)) ||
      t.tags.some((tag: string) => tag.toLowerCase().includes(q))
    );
  }
  if (category) all = all.filter((t) => t.category === category);
  if (subcategory) all = all.filter((t) => t.subcategory === subcategory);
  if (tier) all = all.filter((t) => t.tier === tier);

  // V19 §8: Sort
  if (sort === 'trending') {
    all.sort((a, b) => b.rank - a.rank);
  } else if (sort === 'popular') {
    all.sort((a, b) => b.usageCount - a.usageCount);
  } else if (sort === 'newest') {
    all.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  } else if (sort === 'recommended') {
    // For now, recommended = trending (future: personalized by user history)
    all.sort((a, b) => b.rank - a.rank);
  }

  // Paginate
  const paged = all.slice(offset, offset + limit);

  // V19 §9: Return preview metadata
  return NextResponse.json({
    templates: paged,
    total: all.length,
    limit,
    offset,
  });
}
