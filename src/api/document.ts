import { NodeExplanation, ProjectType } from '@/types';

export interface IngestExistingProject {
  id: string;
  title: string;
  type: 'paper' | 'code';
  sourceType: string | null;
  sourceUrl: string | null;
  updatedAt: string;
  hasPdfAsset: boolean;
}

export interface IngestResult {
  id: string | null;
  title: string;
  rawText: string;
  /**
   * Set when the server detected the URL has already been imported.
   * The caller should show a "open existing / regenerate" modal and
   * NOT auto-create a new project.
   */
  existing?: IngestExistingProject;
}

export class IngestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'IngestError';
    this.status = status;
  }
}

export const parseDocument = async (
  textOrUrl: string,
  file?: File | null,
  projectId?: string | null,
  type: ProjectType = 'paper',
  signal?: AbortSignal
): Promise<IngestResult> => {
  let response: Response;
  try {
    const formData = new FormData();
    if (file) {
      formData.append('file', file);
    } else {
      formData.append('url', textOrUrl);
    }
    if (projectId) {
      formData.append('projectId', projectId);
    }
    formData.append('type', type);

    response = await fetch('/api/ingest', {
      method: 'POST',
      body: formData,
      signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new IngestError('Request was cancelled.', 499);
    }
    // Network / connection errors — surface a meaningful message to the UI.
    throw new IngestError(
      e?.message || 'Network error: could not reach the server.',
      0
    );
  }

  // Try to read the body as JSON even on non-2xx so we can surface the
  // server's specific error message (e.g. "Unsupported file type").
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    // ignore — body wasn't JSON
  }

  if (!response.ok) {
    const message =
      (data && typeof data.error === 'string' && data.error) ||
      `Request failed (status ${response.status})`;
    throw new IngestError(message, response.status);
  }

  // Idempotency hit: server returned an "existing" payload instead of
  // a new project. We surface this to the caller as `result.existing`
  // so the UI can show the "already imported" modal.
  if (data && data.existing && typeof data.existing.id === 'string') {
    return {
      id: null,
      title: data.existing.title ?? '',
      rawText: '',
      existing: {
        id: data.existing.id,
        title: data.existing.title ?? '',
        type: (data.existing.type === 'code' ? 'code' : 'paper'),
        sourceType: data.existing.sourceType ?? null,
        sourceUrl: data.existing.sourceUrl ?? null,
        updatedAt: data.existing.updatedAt ?? '',
        hasPdfAsset: Boolean(data.existing.hasPdfAsset),
      },
    };
  }

  if (!data || typeof data.id !== 'string') {
    throw new IngestError(
      'Server returned an unexpected response shape.',
      500
    );
  }

  return {
    id: data.id,
    title: data.title ?? '',
    rawText: data.rawText ?? '',
  };
};

export const getNodeExplanation = async (
  nodeId: string,
  nodeTitle?: string,
  nodeDescription?: string,
  sourceContext?: string,
  signal?: AbortSignal
): Promise<NodeExplanation | null> => {
  try {
    const res = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        nodeTitle,
        nodeDescription,
        sourceContext,
      }),
      signal,
    });
    if (!res.ok) {
      console.error('Failed to fetch explanation:', res.status);
      return null;
    }
    const data: unknown = await res.json();
    if (data && typeof data === 'object' && 'explanation' in data) {
      return (data as { explanation: NodeExplanation }).explanation || null;
    }
    return null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    console.error('Failed to fetch explanation', err);
    return null;
  }
};
