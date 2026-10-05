import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BoardDocumentSchema,
  BoardsSchema,
  SlotTemplatesSchema,
  type Board,
  type BoardPin,
  type BoardSlot,
  type BoardViewport,
  type SaveBoardLayout,
  type SlotTemplate,
} from '@cura/shared';
import { useTranslation } from 'react-i18next';
import { ApiError, request } from '../catalog/api';
import { AssetTray } from './AssetTray';
import { BoardCanvas, type BoardCanvasHandle } from './BoardCanvas';
import { BoardMatrix } from './BoardMatrix';
import { BoardCreateForm, DeleteConfirm, NameForm } from './BoardForms';
import { SlotHistory } from './SlotHistory';
import { TemplateManager } from './TemplateManager';
import { TemplatePresentationProvider } from './TemplatePresentationProvider';
import { useBoardSlotPresentation } from './template-presentation';
import { useBoardDocument } from './useBoardDocument';
import { useBoardAssetAdder } from './useBoardAssetAdder';
import './i18n';
import './boards.css';

type Dialog =
  | 'create'
  | 'rename'
  | 'delete'
  | 'templates'
  | 'slot'
  | 'deleteSlot'
  | null;
export function BoardsWorkspace({
  libraryId,
  onBack,
}: {
  libraryId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation('boards');
  const [boards, setBoards] = useState<Board[]>([]);
  const [templates, setTemplates] = useState<SlotTemplate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [history, setHistory] = useState<BoardSlot | null>(null);
  const canvas = useRef<BoardCanvasHandle>(null);
  const boardState = useBoardDocument(selected, libraryId);
  const { document, busy, mutate } = boardState;
  const presentSlot = useBoardSlotPresentation(document?.board, templates);
  const addAsset = useBoardAssetAdder(selected, mutate);
  const selectedSlot =
    document?.slots.find((slot) => slot.id === selectedSlotId) ?? null;
  const selectBoard = useCallback((id: string | null) => {
    setSelected(id);
    setSelectedSlotId(null);
    setHistory(null);
    setNotice('');
    setDialog(null);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('board', id);
    else url.searchParams.delete('board');
    window.history.replaceState({}, '', url);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      request(`/api/libraries/${libraryId}/boards`, {
        signal: controller.signal,
      }),
      request(`/api/libraries/${libraryId}/slot-templates`, {
        signal: controller.signal,
      }),
    ])
      .then(([rawBoards, rawTemplates]) => {
        if (controller.signal.aborted) return;
        const next = BoardsSchema.parse(rawBoards);
        setBoards(next);
        setTemplates(SlotTemplatesSchema.parse(rawTemplates));
        setLoadError(false);
        const requested = new URLSearchParams(window.location.search).get(
          'board',
        );
        selectBoard(
          next.find((board) => board.id === requested)?.id ??
            next[0]?.id ??
            null,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [libraryId, retry, selectBoard]);
  const refreshTemplates = async () => {
    setTemplates(
      SlotTemplatesSchema.parse(
        await request(`/api/libraries/${libraryId}/slot-templates`),
      ),
    );
  };
  const saveLayout = useCallback(
    (layout: Omit<SaveBoardLayout, 'expectedRevision'>) =>
      mutate(`/api/boards/${selected}/layout`, 'PUT', () => ({
        ...layout,
        expectedRevision: document?.board.revision,
      })),
    [mutate, selected, document?.board.revision],
  );
  const saveViewport = useCallback(
    (viewport: BoardViewport) =>
      mutate(`/api/boards/${selected}`, 'PATCH', (current) => ({
        viewport,
        expectedRevision: current.board.revision,
      })),
    [mutate, selected],
  );
  const chooseSlot = (slot: BoardSlot) => {
    setSelectedSlotId(slot.id);
    setNotice('');
  };
  const assignSlot = async (
    slot: BoardSlot,
    pin: BoardPin | null,
    expectedRevision?: number,
  ) => {
    const assigned = await mutate(
      `/api/slots/${slot.id}/assignment`,
      'PUT',
      (current) => ({
        expectedRevision:
          expectedRevision ??
          current.slots.find((entry) => entry.id === slot.id)?.revision ??
          slot.revision,
        pin,
      }),
    );
    if (assigned) {
      setSelectedSlotId(null);
      setNotice('');
    }
    return assigned;
  };
  const pickPin = (pin: BoardPin) => {
    if (selectedSlot) void assignSlot(selectedSlot, pin);
    else if (document?.board.kind === 'canvas')
      void canvas.current?.addPin(pin);
    else setNotice(t('chooseAssetHint'));
  };
  const failure = loadError ? t('loadError') : boardState.error || notice;
  return (
    <TemplatePresentationProvider board={document?.board} templates={templates}>
      <main className="boards-workspace" aria-label={t('title')}>
        <header className="boards-header">
          <button className="board-back" onClick={onBack}>
            <span aria-hidden="true">←</span> {t('back')}
          </button>
          <div>
            <h1>{t('title')}</h1>
            <p>{t('subtitle')}</p>
          </div>
          <div className="board-header-status" aria-live="polite">
            {busy ? t('saving') : t('saved')}
            {document && (
              <small>
                {t('boardRevision', { number: document.board.revision })}
              </small>
            )}
          </div>
          <button
            className="primary"
            disabled={loading || busy}
            onClick={() => setDialog('create')}
          >
            <span aria-hidden="true">＋</span> {t('newBoard')}
          </button>
        </header>
        {failure && (
          <div className="board-workspace-alert" role="alert">
            <span>{failure}</span>
            <button
              onClick={() => {
                if (loadError) {
                  setLoading(true);
                  setRetry((value) => value + 1);
                } else if (boardState.error) boardState.refresh();
                else setNotice('');
              }}
            >
              {loadError || boardState.error ? t('retry') : t('close')}
            </button>
            <button
              aria-label={t('close')}
              onClick={() => {
                setLoadError(false);
                boardState.dismissError();
                setNotice('');
              }}
            >
              ×
            </button>
          </div>
        )}
        <div className="boards-body">
          <nav className="board-navigation" aria-label={t('chooseBoard')}>
            <div className="board-section-label">
              {t('title')} <span>{boards.length}</span>
            </div>
            {boards.map((stored) => {
              const board =
                document?.board.id === stored.id ? document.board : stored;
              return (
                <button
                  key={board.id}
                  className={selected === board.id ? 'is-active' : ''}
                  aria-current={selected === board.id ? 'page' : undefined}
                  disabled={busy}
                  onClick={() => selectBoard(board.id)}
                >
                  <span>{board.kind === 'canvas' ? '◈' : '▦'}</span>
                  <span>
                    {board.name}
                    <small>{t(board.kind)}</small>
                  </span>
                </button>
              );
            })}
            <button
              className="board-template-button"
              onClick={() => setDialog('templates')}
            >
              <span aria-hidden="true">▧</span> {t('templates')}
            </button>
          </nav>
          <div className="board-main">
            {loading || boardState.loading ? (
              <div className="board-empty" role="status">
                {t('loading')}
              </div>
            ) : document ? (
              <>
                <div className="board-titlebar">
                  <h2>{document.board.name}</h2>
                  <span className="board-type-badge">
                    {t(document.board.kind)}
                  </span>
                  <div className="board-title-actions">
                    <button
                      disabled={busy}
                      aria-label={t('renameBoard')}
                      onClick={() => setDialog('rename')}
                    >
                      ✎
                    </button>
                    <button
                      disabled={busy}
                      aria-label={t('deleteBoard')}
                      onClick={() => setDialog('delete')}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {selectedSlot && (
                  <div className="board-assignment-bar">
                    <strong>{presentSlot(selectedSlot).label}</strong>
                    <span>{t('chooseAssetHint')}</span>
                    <button
                      disabled={busy || !selectedSlot.currentPin}
                      onClick={() => void assignSlot(selectedSlot, null)}
                    >
                      {t('clearSlot')}
                    </button>
                    {document.board.kind === 'canvas' && (
                      <button
                        disabled={busy}
                        onClick={() => setDialog('deleteSlot')}
                      >
                        {t('deleteSlot')}
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedSlotId(null)}
                      aria-label={t('cancelAssignment')}
                    >
                      ×
                    </button>
                  </div>
                )}
                {document.board.kind === 'canvas' ? (
                  <BoardCanvas
                    key={document.board.id}
                    ref={canvas}
                    document={document}
                    busy={busy}
                    selectedSlot={selectedSlotId}
                    onChoose={chooseSlot}
                    onAssign={assignSlot}
                    onHistory={setHistory}
                    onSave={saveLayout}
                    onAddPin={addAsset}
                    onViewport={saveViewport}
                    onAddSlot={() => setDialog('slot')}
                  />
                ) : (
                  <BoardMatrix
                    key={document.board.id}
                    document={document}
                    busy={busy}
                    selectedSlot={selectedSlotId}
                    onChoose={chooseSlot}
                    onAssign={(slot, pin) => void assignSlot(slot, pin)}
                    onHistory={setHistory}
                    onAxes={(axis, items) =>
                      mutate(`/api/boards/${selected}`, 'PATCH', (current) => ({
                        expectedRevision: current.board.revision,
                        [axis]: items,
                      }))
                    }
                  />
                )}
              </>
            ) : (
              <div className="board-empty">
                <div className="board-empty-art">◈</div>
                <h2>{t('emptyTitle')}</h2>
                <p>{t('emptyHint')}</p>
                <button
                  className="primary"
                  disabled={loadError}
                  onClick={() => setDialog('create')}
                >
                  <span aria-hidden="true">＋</span> {t('noBoard')}
                </button>
              </div>
            )}
          </div>
          <AssetTray
            key={libraryId}
            libraryId={libraryId}
            onPick={pickPin}
            disabled={busy || !document}
          />
        </div>
        {dialog === 'create' && (
          <BoardCreateForm
            templates={templates}
            onClose={() => setDialog(null)}
            onCreate={async (input) => {
              try {
                const created = BoardDocumentSchema.parse(
                  await request(`/api/libraries/${libraryId}/boards`, {
                    method: 'POST',
                    body: input,
                  }),
                );
                setBoards((previous) => [created.board, ...previous]);
                selectBoard(created.board.id);
              } catch {
                throw new Error(t('saveError'));
              }
            }}
          />
        )}
        {dialog === 'rename' && document && (
          <NameForm
            title={t('renameBoard')}
            label={t('boardName')}
            initial={document.board.name}
            onClose={() => setDialog(null)}
            onSave={async (name) => {
              if (
                await mutate(`/api/boards/${selected}`, 'PATCH', (current) => ({
                  expectedRevision: current.board.revision,
                  name,
                }))
              )
                setDialog(null);
              else throw new Error(t('changeNotSaved'));
            }}
          />
        )}
        {dialog === 'delete' && document && (
          <DeleteConfirm
            name={document.board.name}
            hint={t('deleteBoardHint')}
            onClose={() => setDialog(null)}
            onConfirm={async () => {
              try {
                await request(`/api/boards/${selected}`, {
                  method: 'DELETE',
                  body: { expectedRevision: document.board.revision },
                });
                const remaining = boards.filter(
                  (board) => board.id !== selected,
                );
                setBoards(remaining);
                selectBoard(remaining[0]?.id ?? null);
              } catch (error) {
                if (error instanceof ApiError && error.status === 409) {
                  setDialog(null);
                  boardState.refresh();
                  setNotice(t('conflict'));
                } else throw new Error(t('saveError'));
              }
            }}
          />
        )}
        {dialog === 'templates' && (
          <TemplateManager
            libraryId={libraryId}
            templates={templates}
            onClose={() => setDialog(null)}
            onChanged={refreshTemplates}
          />
        )}
        {dialog === 'slot' && document && (
          <NameForm
            title={t('addSlot')}
            label={t('slotName')}
            onClose={() => setDialog(null)}
            onSave={async (label) => {
              if (
                await mutate(
                  `/api/boards/${selected}/slots`,
                  'POST',
                  (current) => ({
                    expectedRevision: current.board.revision,
                    label,
                    x: 40 + current.slots.length * 40,
                    y: 40 + current.slots.length * 40,
                    width: 240,
                    height: 220,
                  }),
                )
              )
                setDialog(null);
              else throw new Error(t('changeNotSaved'));
            }}
          />
        )}
        {dialog === 'deleteSlot' && selectedSlot && (
          <DeleteConfirm
            name={presentSlot(selectedSlot).label}
            hint={t('deleteAxisHint')}
            onClose={() => setDialog(null)}
            onConfirm={async () => {
              if (
                await mutate(
                  `/api/slots/${selectedSlot.id}`,
                  'DELETE',
                  (current) => ({
                    expectedRevision:
                      current.slots.find((slot) => slot.id === selectedSlot.id)
                        ?.revision ?? selectedSlot.revision,
                  }),
                )
              ) {
                setSelectedSlotId(null);
                setDialog(null);
              } else throw new Error(t('changeNotSaved'));
            }}
          />
        )}
        {history && (
          <SlotHistory slot={history} onClose={() => setHistory(null)} />
        )}
      </main>
    </TemplatePresentationProvider>
  );
}
