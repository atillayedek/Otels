import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/urun', '/nasil-calisir', '/on-siparis', '/kvkk'].map(p => ({ url: `${SITE.url}${p}` }));
}
