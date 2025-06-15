import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stack } from "@/components/ui/stack";
import { Textarea } from "@/components/ui/textarea";

import { useMindmapFlow } from "../../providers/MindmapFlowProvider";

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
  const [title, setTitle] = useState(_title);
  const [description, setDescription] = useState(_description ?? "");
  const [link, setLink] = useState(_link ?? "");

  const {
    setSelectedNode,
    actions: { onUpdateNode },
  } = useMindmapFlow();

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
    },
    [focusableElements]
  );

  return (
    // since we want to provide navigation across fields with tab
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- is needed
    <form onKeyDown={handleKeyDown} className="space-y-4" ref={formRef}>
      <Label htmlFor="title">Title</Label>
      <Input
        id="title"
        maxLength={50}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <Label htmlFor="description">Description</Label>
      <Textarea
        id="description"
        maxLength={150}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <Label htmlFor="link">Link</Label>
      <Input
        id="link"
        maxLength={100}
        value={link}
        onChange={(e) => setLink(e.target.value)}
      />

      <Button onClick={handleSave}>Save</Button>
    </form>
  );
}

export default function NodeDataInput() {
  const { selectedNode, nodesMap } = useMindmapFlow();

  // selectedNode is not null
  const node = nodesMap[selectedNode!];

  if (!node) return null;

  return (
    <Stack className="gap-y-4" direction="column">
      <NodeDataInputForm
        title={node.data.title}
        description={node.data.description}
        link={node.data.link}
        nodeId={node.id}
      />
    </Stack>
  );
}
