'use client';

import { DatasetCatalog } from '@/components/datasets/dataset-catalog';

// The primary Data Ingestion UX opens this as a modal. Keep the
// route as a direct-link fallback for refreshes, bookmarks, and older
// navigation entries.
export default function CatalogPage() {
  return <DatasetCatalog variant="page" />;
}
