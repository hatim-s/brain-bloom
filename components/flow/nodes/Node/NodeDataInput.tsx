import { ExternalLink, LinkIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AutosizeTextarea } from "@/components/auto-resizer-textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useMindmapFlow } from "../../providers/MindmapFlowProvider";

type NodeFormData = {
  title: string;
  description: string;
  link: string;
};

/** Every element the editor's own Tab cycle is allowed to land on. */
type EditorFocusable =
  HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement;

/**
 * The focus well each field sits in — title, description, and the link row.
 *
 * Fields carry no chrome at rest — the card looks like the node, read as text.
 * On focus a quiet sunken well and a moss hairline appear around just that
 * field, which is also the focus indicator (the fields themselves suppress the
 * product-wide outline so the ring never doubles up).
 */
const FIELD_WELL =
  "-mx-2 rounded-[10px] px-2 py-1 transition-colors duration-200 ease-settle motion-reduce:transition-none focus-within:bg-secondary/60 focus-within:ring-1 focus-within:ring-primary";

/** Shared reset for the borderless fields living inside a focus well. */
const BARE_FIELD =
  "w-full border-0 bg-transparent p-0 shadow-none placeholder:text-muted-foreground/70 focus-visible:outline-none";

/**
 * Normalizes a typed link into something safe to open in a new tab.
 *
 * Writers paste bare hosts as often as full URLs, so a missing scheme is
 * assumed to be https rather than treated as a broken value. Returns null when
 * there is nothing to open, which is what disables the affordance.
 */
function toExternalHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
}

/**
 * The node, opened up and editable.
 *
 * Not a form: a card anchored to the node whose title, description, and link
 * are typed in place at roughly the sizes they will settle back into. Enter
 * saves, Shift+Enter breaks a line inside the description only, Esc leaves
 * without saving, and Tab walks the card's own fields so the canvas underneath
 * never steals the key.
 */
function NodeDataInputForm({
  title: _title,
  description: _description,
  link: _link,
  nodeId,
}: {
  title: string;
  description?: string;
  link?: string;
  nodeId: string;
}) {
  const sourceData = useMemo<NodeFormData>(
    () => ({
      title: _title,
      description: _description ?? "",
      link: _link ?? "",
    }),
    [_description, _link, _title]
  );
  const seededDataRef = useRef<NodeFormData>(sourceData);
  const [title, setTitle] = useState(sourceData.title);
  const [description, setDescription] = useState(sourceData.description);
  const [link, setLink] = useState(sourceData.link);
  const [conflictedFields, setConflictedFields] = useState<
    Set<keyof NodeFormData>
  >(new Set());

  const setSelectedNode = useMindmapFlow((state) => state.setSelectedNode);
  const onUpdateNode = useMindmapFlow((state) => state.actions.onUpdateNode);

  useEffect(() => {
    const seededData = seededDataRef.current;
    const currentData = { title, description, link };
    const nextConflictedFields = new Set(conflictedFields);
    let conflictsChanged = false;

    /**
     * Advances one field's server baseline without overwriting local work.
     */
    function mergeField(
      field: keyof NodeFormData,
      updateValue: (value: string) => void
    ): void {
      if (sourceData[field] === seededData[field]) {
        return;
      }

      if (currentData[field] === seededData[field]) {
        updateValue(sourceData[field]);
        if (nextConflictedFields.delete(field)) {
          conflictsChanged = true;
        }
      } else if (currentData[field] !== sourceData[field]) {
        if (!nextConflictedFields.has(field)) {
          nextConflictedFields.add(field);
          conflictsChanged = true;
        }
      } else if (nextConflictedFields.delete(field)) {
        conflictsChanged = true;
      }
    }

    mergeField("title", setTitle);
    mergeField("description", setDescription);
    mergeField("link", setLink);
    seededDataRef.current = sourceData;

    if (conflictsChanged) {
      setConflictedFields(nextConflictedFields);
    }
  }, [conflictedFields, description, link, sourceData, title]);

  const handleSave = useCallback(() => {
    setSelectedNode(null);
    onUpdateNode(nodeId, {
      title,
      description,
      link,
    });
  }, [setSelectedNode, onUpdateNode, nodeId, title, description, link]);

  /** Leaves the card exactly as the node was: nothing is written. */
  const handleClose = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  const formRef = useRef<HTMLFormElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

  /**
   * Reads the card's live focus order.
   *
   * Queried per keystroke rather than cached at mount so the external-link
   * affordance joins and leaves the cycle as the link field fills and empties.
   */
  const getFocusables = useCallback((): EditorFocusable[] => {
    const elements = Array.from(
      formRef.current?.querySelectorAll<EditorFocusable>(
        "input, textarea, button"
      ) ?? []
    );
    return elements.filter((element) => !element.disabled);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        // The canvas closes editors on Escape too; handling it here keeps the
        // card self-contained and makes "close without saving" explicit.
        handleClose();
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();

        const focusables = getFocusables();
        if (focusables.length === 0) return;

        const currentIndex = focusables.indexOf(e.target as EditorFocusable);
        const step = e.shiftKey ? -1 : 1;
        const nextIndex =
          (currentIndex + step + focusables.length) % focusables.length;
        focusables[nextIndex].focus();
        return;
      }

      if (e.key === "Enter") {
        // Buttons own their own activation, and Shift+Enter is a newline — but
        // only inside the description, the one field that holds prose.
        if (e.target instanceof HTMLButtonElement) return;
        if (e.shiftKey && e.target === descriptionRef.current) return;

        e.preventDefault();
        e.stopPropagation();
        handleSave();
      }
    },
    [getFocusables, handleClose, handleSave]
  );

  const externalHref = toExternalHref(link);

  return (
    // The card owns Tab and Enter so the canvas behind it never sees them.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- is needed
    <form
      className="flex flex-col gap-2 p-3.5"
      onKeyDown={handleKeyDown}
      ref={formRef}
    >
      <div className={FIELD_WELL}>
        <input
          aria-label="Title"
          className={cn(
            BARE_FIELD,
            "text-[19px] font-semibold leading-[26px] tracking-[-0.01em] text-foreground"
          )}
          maxLength={50}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          value={title}
        />
      </div>

      <div className={FIELD_WELL}>
        <AutosizeTextarea
          aria-label="Description"
          className={cn(
            BARE_FIELD,
            "resize-none text-[15px] leading-[24px] text-muted-foreground focus-visible:text-foreground focus-visible:ring-0"
          )}
          maxHeight={132}
          maxLength={150}
          minHeight={24}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add a note…"
          ref={(instance) => {
            descriptionRef.current = instance?.textArea ?? null;
          }}
          value={description}
        />
      </div>

      {/* One affordance line, not a labelled field: the icon says "link", the
          input is the value, and the way out to the browser only appears once
          there is somewhere to go. */}
      <div className={cn(FIELD_WELL, "flex items-center gap-2")}>
        <LinkIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <input
          aria-label="Link"
          className={cn(
            BARE_FIELD,
            "min-w-0 flex-1 text-[13px] leading-[20px]"
          )}
          maxLength={100}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Add a link"
          value={link}
        />
        {externalHref === null ? null : (
          <Button
            aria-label="Open link in a new tab"
            className="-my-0.5 !size-6 shrink-0 text-muted-foreground hover:text-primary [&_svg]:!size-3.5"
            onClick={() =>
              window.open(externalHref, "_blank", "noopener,noreferrer")
            }
            size="icon"
            type="button"
            variant="ghost"
          >
            <ExternalLink aria-hidden="true" />
          </Button>
        )}
      </div>

      {conflictedFields.size > 0 ? (
        <p
          className="text-[11px] leading-[16px] text-muted-foreground"
          role="status"
        >
          This node changed elsewhere — saving will overwrite.
        </p>
      ) : null}

      <div className="mt-0.5 flex items-center justify-between gap-3 border-t border-border pt-2.5">
        {/* Caption voice at the card's foot; mono is reserved for the keys. */}
        <p className="text-[11px] leading-none text-muted-foreground">
          <kbd className="font-mono">enter</kbd> to save ·{" "}
          <kbd className="font-mono">esc</kbd> to close
        </p>
        <Button onClick={handleSave} size="sm" type="button">
          Save
        </Button>
      </div>
    </form>
  );
}

/** Anchors the editable card to whichever node the canvas has selected. */
function NodeDataInput() {
  const selectedNode = useMindmapFlow((state) => state.selectedNode);
  const nodesMap = useMindmapFlow((state) => state.nodesMap);

  // selectedNode is not null
  const node = nodesMap[selectedNode!];

  if (!node) return null;

  return (
    <NodeDataInputForm
      title={node.data.title}
      description={node.data.description}
      key={node.id}
      link={node.data.link}
      nodeId={node.id}
    />
  );
}

export { NodeDataInput };
