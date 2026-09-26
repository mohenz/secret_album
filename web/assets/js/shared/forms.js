// 모델·앨범 등록/수정 Sheet 폼 (관리 영역, Bloom 기본 UI).
import { api } from './api.js';
import { formDialog } from './ui.js';

export function modelForm(model) {
  return formDialog({
    title: model ? 'Edit model' : 'Add model',
    sheet: true,
    submitLabel: model ? 'Save changes' : 'Add model',
    fields: [
      { name: 'name', label: 'Name', required: true, value: model?.name, maxlength: 120 },
      { name: 'stage_name', label: 'Stage name', value: model?.stage_name, maxlength: 120 },
      { name: 'bio', label: 'Bio', type: 'textarea', value: model?.bio, maxlength: 4000 },
    ],
    onSubmit: (values) => (model
      ? api(`/models/${model.id}`, { method: 'PATCH', body: values })
      : api('/models', { method: 'POST', body: values })),
  });
}

export async function albumForm(album, { modelId } = {}) {
  const { items: models } = await api('/models?sort=name_asc');
  if (!models.length) {
    const created = await modelForm(null);
    if (!created) return null;
    return albumForm(album, { modelId: created.id });
  }
  return formDialog({
    title: album ? 'Edit album' : 'Create album',
    sheet: true,
    submitLabel: album ? 'Save changes' : 'Create album',
    fields: [
      { name: 'title', label: 'Title', required: true, value: album?.title, maxlength: 200 },
      { name: 'model_id', label: 'Model', type: 'select', required: true, value: album?.model_id || modelId, options: models.map((m) => ({ value: m.id, label: m.name })) },
      { name: 'shot_on', label: 'Shoot date', type: 'date', value: album?.shot_on || '' },
      { name: 'location', label: 'Location', value: album?.location, maxlength: 200, hint: 'e.g. Seongsu-dong, Seoul' },
      { name: 'description', label: 'Description', type: 'textarea', value: album?.description, maxlength: 8000 },
    ],
    onSubmit: (values) => {
      const body = { ...values, shot_on: values.shot_on || null };
      return album ? api(`/albums/${album.id}`, { method: 'PATCH', body }) : api('/albums', { method: 'POST', body });
    },
  });
}
