import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { GripVertical } from 'lucide-react';
import { ShotRow } from './ShotRow';
import type { Shot, ShotFields } from '../../types';

interface SceneGroupData {
  sceneItemId: string | null;
  sceneTitle: string;
  shots: Shot[];
}

interface SceneGroupProps {
  group: SceneGroupData;
  groupIndex: number;
  onUpdateField: (shotId: string, fieldKey: string, newValue: string, existingFields: ShotFields) => void;
  renderActionCell?: (shot: Shot, groupShots: Shot[]) => React.ReactNode;
  renderAddButton?: (sceneItemId: string | null) => React.ReactNode;
  onReorderGroup?: (sceneItemId: string | null, orderedShotIds: string[]) => void;
}

export function SceneGroup({ group, onUpdateField, renderActionCell, renderAddButton, onReorderGroup }: SceneGroupProps) {
  const shotCount = group.shots.length;
  const countLabel = shotCount === 1 ? '1 shot' : `${shotCount} shots`;
  const sortedShots = [...group.shots].sort((a, b) => a.sort_order - b.sort_order);
  const droppableId = group.sceneItemId ?? 'unassigned';

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;

    const reordered = [...sortedShots];
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);

    onReorderGroup?.(group.sceneItemId, reordered.map(s => s.id));
  };

  return (
    <div>
      {/* Scene header */}
      <div className="flex items-center justify-between px-4 py-2 bg-card/60"
        style={{ borderBottom: '1px solid hsl(var(--border))' }}>
        <span className="text-[13px] font-semibold text-foreground">
          {group.sceneTitle}
        </span>
        <span className="text-xs text-muted-foreground">
          {countLabel}
        </span>
      </div>

      {/* Shot rows with drag-and-drop */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId={droppableId}>
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              {sortedShots.map((shot, idx) => (
                <Draggable key={shot.id} draggableId={shot.id} index={idx}>
                  {(dragProvided) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      style={{
                        borderBottom: '1px solid hsl(var(--border) / 0.5)',
                        ...dragProvided.draggableProps.style,
                      }}
                      className="flex items-stretch"
                    >
                      {/* Drag handle */}
                      <div
                        {...dragProvided.dragHandleProps}
                        className="flex items-center px-1 text-muted-foreground/30 hover:text-muted-foreground/60 cursor-grab active:cursor-grabbing flex-shrink-0"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <ShotRow
                          shot={shot}
                          onUpdateField={onUpdateField}
                          actionCell={renderActionCell?.(shot, group.shots)}
                        />
                      </div>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {/* Add shot button slot */}
      {renderAddButton?.(group.sceneItemId)}
    </div>
  );
}

export type { SceneGroupData };
