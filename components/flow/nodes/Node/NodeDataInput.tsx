import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stack } from "@/components/ui/stack";
import { Textarea } from "@/components/ui/textarea";

import { useMindmapFlow } from "../../providers/MindmapFlowProvider";

type NodeFormData = {
  title: string;
  description: string;
  link: string;
};

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

  const formRef = useRef<HTMLFormElement>(null);
  const [focusableElements, setFocusableElements] = useState<
    (HTMLInputElement | HTMLTextAreaElement)[]
  >([]);

  useEffect(() => {
    const formEl = formRef.current;

    const focusableElements = Array.from(
      formEl?.querySelectorAll("input, textarea") ?? []
    ) as (HTMLInputElement | HTMLTextAreaElement)[];

    setFocusableElements(focusableElements);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();

        // focus on the next focusable element
        const currentIndex = focusableElements.indexOf(
          e.target as HTMLInputElement | HTMLTextAreaElement
        );
        const nextIndex = (currentIndex + 1) % focusableElements.length;
        focusableElements[nextIndex].focus();
      }

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      }
    },
    [focusableElements, handleSave]
  );

  return (
    // since we want to provide navigation across fields with tab
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- is needed
    <form
      onKeyDown={handleKeyDown}
      className="gap-y-4 flex flex-col"
      ref={formRef}
    >
      <Stack className="gap-y-2" direction="column">
        <Label className="ms-1" htmlFor="title">
          Title
        </Label>
        <Input
          id="title"
          maxLength={50}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Stack>

      <Stack className="gap-y-2" direction="column">
        <Label className="ms-1" htmlFor="description">
          Description
        </Label>
        <Textarea
          id="description"
          maxLength={150}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Stack>

      <Stack className="gap-y-2" direction="column">
        <Label className="ms-1" htmlFor="link">
          Link
        </Label>
        <Input
          id="link"
          maxLength={100}
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
      </Stack>

      {conflictedFields.size > 0 ? (
        <p className="text-xs text-muted-foreground" role="status">
          This node changed elsewhere — saving will overwrite.
        </p>
      ) : null}

      <Button onClick={handleSave} type="button">
        Save
      </Button>
    </form>
  );
}

function NodeDataInput() {
  const selectedNode = useMindmapFlow((state) => state.selectedNode);
  const nodesMap = useMindmapFlow((state) => state.nodesMap);

  // selectedNode is not null
  const node = nodesMap[selectedNode!];

  if (!node) return null;

  return (
    <Stack className="gap-y-4" direction="column">
      <NodeDataInputForm
        title={node.data.title}
        description={node.data.description}
        key={node.id}
        link={node.data.link}
        nodeId={node.id}
      />
    </Stack>
  );
}

export { NodeDataInput };
