import { useEffect, useState } from 'react';
import { apiClient, type CustomWorkflow, type UpdateWorkflowPayload } from '../lib/apiClient';
import { studios } from '../lib/studioConfig';

type EditTab = 'metadata' | 'variables' | 'sections';

interface EditState {
  form: Partial<UpdateWorkflowPayload>;
  variableJson: string;
  sectionJson: string;
  variableError: string | null;
  sectionError: string | null;
  tab: EditTab;
}

function makeEditState(wf: CustomWorkflow): EditState {
  return {
    form: {
      name: wf.name,
      description: wf.description ?? '',
      studio: wf.studio ?? '',
      output_type: wf.output_type,
      icon: wf.icon,
      gradient: wf.gradient,
    },
    variableJson: JSON.stringify(wf.variable_config, null, 2),
    sectionJson: JSON.stringify(wf.section_config, null, 2),
    variableError: null,
    sectionError: null,
    tab: 'metadata',
  };
}

function tryParseJson(str: string): { ok: true; value: Record<string, unknown>[] } | { ok: false; error: string } {
  try {
    const v = JSON.parse(str);
    if (!Array.isArray(v)) return { ok: false, error: 'Must be a JSON array' };
    return { ok: true, value: v as Record<string, unknown>[] };
  } catch (e: unknown) {
    return { ok: false, error: String(e) };
  }
}

export default function WorkflowList() {
  const [workflows, setWorkflows] = useState<CustomWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await apiClient.listCustomWorkflows();
    if (res.success) {
      setWorkflows(res.workflows);
    } else {
      setError(res.error ?? 'Failed to load workflows');
    }
    setLoading(false);
  }

  async function handleTogglePublish(wf: CustomWorkflow) {
    setToggling(wf.id);
    try {
      if (wf.is_published) {
        await apiClient.unpublishCustomWorkflow(wf.id);
      } else {
        await apiClient.publishCustomWorkflow(wf.id);
      }
      setWorkflows((prev) =>
        prev.map((w) => (w.id === wf.id ? { ...w, is_published: !wf.is_published } : w))
      );
    } catch {
      // silent
    }
    setToggling(null);
  }

  async function handleDelete(wf: CustomWorkflow) {
    if (!window.confirm(`Delete "${wf.name}"? This cannot be undone.`)) return;
    await apiClient.deleteCustomWorkflow(wf.id);
    setWorkflows((prev) => prev.filter((w) => w.id !== wf.id));
  }

  function startEdit(wf: CustomWorkflow) {
    setEditingId(wf.id);
    setEditState(makeEditState(wf));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditState(null);
  }

  async function handleSaveEdit(id: string) {
    if (!editState) return;

    const varResult = tryParseJson(editState.variableJson);
    const secResult = tryParseJson(editState.sectionJson);

    if (!varResult.ok || !secResult.ok) {
      setEditState((s) => s ? {
        ...s,
        variableError: varResult.ok ? null : varResult.error,
        sectionError: secResult.ok ? null : secResult.error,
        tab: !varResult.ok ? 'variables' : 'sections',
      } : s);
      return;
    }

    setSaving(true);
    const payload: UpdateWorkflowPayload = {
      ...editState.form,
      variable_config: varResult.value,
      section_config: secResult.value,
    };
    const res = await apiClient.updateCustomWorkflow(id, payload);
    if (res.success && res.workflow) {
      setWorkflows((prev) => prev.map((w) => (w.id === id ? res.workflow! : w)));
      setEditingId(null);
      setEditState(null);
    }
    setSaving(false);
  }

  const setForm = (updater: (f: Partial<UpdateWorkflowPayload>) => Partial<UpdateWorkflowPayload>) => {
    setEditState((s) => s ? { ...s, form: updater(s.form) } : s);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
        Loading workflows…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 text-sm">
        {error}
        <button onClick={() => void load()} className="ml-3 underline">Retry</button>
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center">
        <div className="text-4xl mb-3">⚡</div>
        <p className="font-semibold text-gray-700">No workflows yet</p>
        <p className="text-sm text-gray-500 mt-1">Create one in the Workflow Builder tab.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {workflows.map((wf) => (
        <div key={wf.id} className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          {/* Row */}
          <div className="p-4 flex items-center gap-4">
            {/* Icon */}
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${wf.gradient} flex items-center justify-center text-lg flex-shrink-0`}>
              {wf.icon}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-900 truncate">{wf.name}</span>
                <span className="text-xs text-gray-400 font-mono">{wf.slug}</span>
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
                <span className="capitalize">{wf.output_type}</span>
                {wf.studio && (
                  <span>{studios.find((s) => s.id === wf.studio)?.title ?? wf.studio}</span>
                )}
                <span>{wf.variable_config.length} variable{wf.variable_config.length !== 1 ? 's' : ''}</span>
                <span>{new Date(wf.created_at).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Publish toggle */}
            <button
              onClick={() => void handleTogglePublish(wf)}
              disabled={toggling === wf.id}
              title={wf.is_published ? 'Published — click to unpublish' : 'Draft — click to publish'}
              className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${
                wf.is_published ? 'bg-green-500' : 'bg-gray-300'
              } disabled:opacity-50`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                wf.is_published ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
            <span className="text-xs text-gray-500 w-16 flex-shrink-0">
              {wf.is_published ? '✅ Live' : '⬜ Draft'}
            </span>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => editingId === wf.id ? cancelEdit() : startEdit(wf)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
              >
                {editingId === wf.id ? 'Cancel' : 'Edit'}
              </button>
              <button
                onClick={() => void handleDelete(wf)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>

          {/* Edit panel */}
          {editingId === wf.id && editState && (
            <div className="border-t border-gray-200 bg-gray-50">
              {/* Tab bar */}
              <div className="flex border-b border-gray-200 px-4 pt-3 gap-1">
                {(['metadata', 'variables', 'sections'] as EditTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setEditState((s) => s ? { ...s, tab } : s)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition-colors capitalize ${
                      editState.tab === tab
                        ? 'bg-white border border-b-white border-gray-200 -mb-px text-blue-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab}
                    {tab === 'variables' && editState.variableError && (
                      <span className="ml-1 text-red-500">⚠</span>
                    )}
                    {tab === 'sections' && editState.sectionError && (
                      <span className="ml-1 text-red-500">⚠</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="p-4 space-y-3">
                {/* ── Metadata tab ── */}
                {editState.tab === 'metadata' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Name</label>
                        <input
                          type="text"
                          value={editState.form.name ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Studio</label>
                        <select
                          value={editState.form.studio ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, studio: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all bg-white"
                        >
                          <option value="">No studio</option>
                          {studios.filter((s) => !s.adminOnly).map((s) => (
                            <option key={s.id} value={s.id}>{s.title}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Output type</label>
                        <select
                          value={editState.form.output_type ?? 'image'}
                          onChange={(e) => setForm((f) => ({ ...f, output_type: e.target.value as 'image' | 'video' | 'audio' }))}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all bg-white"
                        >
                          <option value="image">Image</option>
                          <option value="video">Video</option>
                          <option value="audio">Audio</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Icon</label>
                        <input
                          type="text"
                          value={editState.form.icon ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all bg-white"
                          placeholder="⚡"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Gradient</label>
                        <input
                          type="text"
                          value={editState.form.gradient ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, gradient: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all bg-white"
                          placeholder="from-blue-500 to-purple-600"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
                      <textarea
                        rows={2}
                        value={editState.form.description ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all bg-white resize-none"
                      />
                    </div>
                    {/* Gradient preview */}
                    {editState.form.gradient && (
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${editState.form.gradient} flex items-center justify-center text-lg`}>
                          {editState.form.icon || '⚡'}
                        </div>
                        <span className="text-xs text-gray-500">Preview</span>
                      </div>
                    )}
                  </>
                )}

                {/* ── Variables tab ── */}
                {editState.tab === 'variables' && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-gray-600">
                        variable_config <span className="font-normal text-gray-400">(JSON array)</span>
                      </label>
                      <span className="text-xs text-gray-400">
                        Each item: node_id, input_name, label, type, default, required, description
                      </span>
                    </div>
                    <textarea
                      rows={16}
                      value={editState.variableJson}
                      onChange={(e) => setEditState((s) => s ? { ...s, variableJson: e.target.value, variableError: null } : s)}
                      spellCheck={false}
                      className={`w-full rounded-xl border px-3 py-2 text-xs font-mono focus:ring-2 transition-all bg-white resize-y ${
                        editState.variableError
                          ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
                          : 'border-gray-200 focus:border-blue-400 focus:ring-blue-100'
                      }`}
                    />
                    {editState.variableError && (
                      <p className="mt-1 text-xs text-red-600">{editState.variableError}</p>
                    )}
                    <p className="mt-1 text-xs text-gray-400">
                      Valid types: text, number, image, audio, video, boolean, select
                    </p>
                  </div>
                )}

                {/* ── Sections tab ── */}
                {editState.tab === 'sections' && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-gray-600">
                        section_config <span className="font-normal text-gray-400">(JSON array)</span>
                      </label>
                      <span className="text-xs text-gray-400">
                        Each item: id, name, variable_ids[]
                      </span>
                    </div>
                    <textarea
                      rows={10}
                      value={editState.sectionJson}
                      onChange={(e) => setEditState((s) => s ? { ...s, sectionJson: e.target.value, sectionError: null } : s)}
                      spellCheck={false}
                      className={`w-full rounded-xl border px-3 py-2 text-xs font-mono focus:ring-2 transition-all bg-white resize-y ${
                        editState.sectionError
                          ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
                          : 'border-gray-200 focus:border-blue-400 focus:ring-blue-100'
                      }`}
                    />
                    {editState.sectionError && (
                      <p className="mt-1 text-xs text-red-600">{editState.sectionError}</p>
                    )}
                    <p className="mt-1 text-xs text-gray-400">
                      variable_ids must reference IDs defined in variable_config
                    </p>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => void handleSaveEdit(wf.id)}
                    disabled={saving}
                    className="px-5 py-2 text-sm font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
