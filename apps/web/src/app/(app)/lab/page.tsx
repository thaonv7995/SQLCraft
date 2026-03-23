'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';

const DATASET_OPTIONS = [
  { value: 'tiny', label: 'Tiny', desc: '~1,000 rows — fastest, ideal for learning syntax' },
  { value: 'small', label: 'Small', desc: '~10,000 rows — balanced for most exercises' },
  { value: 'medium', label: 'Medium', desc: '~100,000 rows — realistic performance testing' },
  { value: 'large', label: 'Large', desc: '~1,000,000 rows — optimization challenges' },
] as const;

type DatasetSize = typeof DATASET_OPTIONS[number]['value'];

export default function LabIndexPage() {
  const router = useRouter();
  const [datasetSize, setDatasetSize] = useState<DatasetSize>('small');
  const [loading, setLoading] = useState(false);

  const handleStart = async () => {
    setLoading(true);
    try {
      const session = await sessionsApi.create({ datasetSize });
      router.push(`/lab/${session.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create session';
      toast.error(msg);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary to-[#4453a7] flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-3xl text-[#00105b]">terminal</span>
          </div>
          <h1 className="font-headline text-2xl font-bold text-on-surface">SQL Workspace</h1>
          <p className="text-sm text-on-surface-variant mt-2">
            Spin up a fresh sandbox and start writing queries against real data.
          </p>
        </div>

        {/* Dataset size selection */}
        <div className="bg-surface-container-low rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-on-surface">Choose Dataset Size</h2>
          <div className="space-y-2">
            {DATASET_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDatasetSize(opt.value)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left ${
                  datasetSize === opt.value
                    ? 'bg-primary/10 border border-primary/30'
                    : 'bg-surface-container hover:bg-surface-container-high border border-transparent'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    datasetSize === opt.value ? 'border-primary' : 'border-outline'
                  }`}
                >
                  {datasetSize === opt.value && (
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  )}
                </div>
                <div>
                  <p className={`text-sm font-medium ${datasetSize === opt.value ? 'text-primary' : 'text-on-surface'}`}>
                    {opt.label}
                  </p>
                  <p className="text-xs text-on-surface-variant">{opt.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <Button
          variant="primary"
          fullWidth
          size="lg"
          loading={loading}
          onClick={handleStart}
          leftIcon={<span className="material-symbols-outlined">rocket_launch</span>}
        >
          {loading ? 'Provisioning sandbox...' : 'Launch Workspace'}
        </Button>

        <p className="text-center text-xs text-outline">
          Sandbox sessions auto-expire after 2 hours of inactivity
        </p>
      </div>
    </div>
  );
}
