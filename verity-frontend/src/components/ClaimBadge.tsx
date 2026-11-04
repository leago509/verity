import type { Classification } from '../types';

const STYLES: Record<Classification, { label: string; cls: string }> = {
  SUPPORTED: { label: 'Supported', cls: 'bg-green-100 text-green-800' },
  PARTIALLY_SUPPORTED: { label: 'Partially supported', cls: 'bg-amber-100 text-amber-800' },
  UNSUPPORTED: { label: 'Unsupported', cls: 'bg-red-100 text-red-800' },
};

export function ClaimBadge({ classification }: { classification: Classification }) {
  const { label, cls } = STYLES[classification];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
