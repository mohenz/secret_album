// 모델·앨범 등록/수정 Sheet 폼 (관리 영역, Bloom 기본 UI).
import { api } from './api.js';
import { formDialog } from './ui.js';

export function modelForm(model) {
  return formDialog({
    title: model ? '모델 정보 수정' : '모델 등록',
    sheet: true,
    submitLabel: model ? '변경사항 저장' : '모델 등록',
    fields: [
      { name: 'name', label: '모델명', required: true, value: model?.name, maxlength: 120 },
      { name: 'stage_name', label: '활동명', value: model?.stage_name, maxlength: 120 },
      { name: 'bio', label: '소개', type: 'textarea', value: model?.bio, maxlength: 4000 },
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
    title: album ? '앨범 정보 수정' : '앨범 만들기',
    sheet: true,
    submitLabel: album ? '변경사항 저장' : '앨범 만들기',
    fields: [
      { name: 'title', label: '앨범명', required: true, value: album?.title, maxlength: 200 },
      { name: 'model_id', label: '모델', type: 'select', required: true, value: album?.model_id || modelId, options: models.map((m) => ({ value: m.id, label: m.name })) },
      { name: 'shot_on', label: '촬영일', type: 'date', value: album?.shot_on || '' },
      { name: 'location', label: '촬영 장소', value: album?.location, maxlength: 200, hint: '예: 서울 성동구 성수동' },
      { name: 'description', label: '설명', type: 'textarea', value: album?.description, maxlength: 8000 },
    ],
    onSubmit: (values) => {
      const body = { ...values, shot_on: values.shot_on || null };
      return album ? api(`/albums/${album.id}`, { method: 'PATCH', body }) : api('/albums', { method: 'POST', body });
    },
  });
}
