import { useState, useEffect, useMemo } from 'react';
import { apiClient, type CustomWorkflow } from '../lib/apiClient';

/**
 * Fetches all published custom workflow configs once at app startup.
 * Exposes the list flat (workflows) and grouped by studio.id (byStudio).
 *
 * Silent fail: if the network request fails, dynamic workflows simply don't
 * appear in nav — the static app is unaffected.
 */
export function useDynamicWorkflows() {
  const [workflows, setWorkflows] = useState<CustomWorkflow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    apiClient
      .listPublishedWorkflows()
      .then((resp) => {
        if (!cancelled && resp.success) {
          setWorkflows(resp.workflows);
        }
      })
      .catch(() => {
        // Silent fail — dynamic features just won't appear
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Group by studio for easy consumption in sidebar and StudioPage
  const byStudio = useMemo((): Record<string, CustomWorkflow[]> => {
    const map: Record<string, CustomWorkflow[]> = {};
    for (const wf of workflows) {
      if (wf.studio) {
        map[wf.studio] = map[wf.studio] || [];
        map[wf.studio].push(wf);
      }
    }
    return map;
  }, [workflows]);

  return { workflows, byStudio, loading };
}
